"""LiveKit hook scheduling regressions; no speech/provider network calls."""
import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from earthora_agent import EarthoraAgent, StopResponse
from earthora_bridge import VoiceContext


class PendingSpeech:
    def __init__(self):
        self.future = asyncio.get_running_loop().create_future()
        self.interrupted = False

    def __await__(self):
        return self.future.__await__()

    def finish(self, *, interrupted=False):
        self.interrupted = interrupted
        self.future.set_result(None)


class Events:
    def __init__(self):
        self.tasks = set()
        self.sent = []

    async def send(self, kind, **payload):
        self.sent.append((kind, payload))


class Bridge:
    def __init__(self, *, end=False):
        self.end = end
        self.turns = []

    async def turn(self, context, **fields):
        self.turns.append(fields)
        return SimpleNamespace(text='Validated response.', language='en', end_session=self.end)


class Provider:
    def update_options(self, **options):
        pass


class Session:
    def __init__(self):
        self.speeches = []

    def say(self, text):
        speech = PendingSpeech()
        self.speeches.append(speech)
        return speech


class AgentUnderTest(EarthoraAgent):
    @property
    def session(self):
        return self.test_session

    async def update_chat_ctx(self, context):
        self._chat_ctx = context


def make_agent(*, end=False):
    events, bridge, closed = Events(), Bridge(end=end), []
    agent = AgentUnderTest(
        context=VoiceContext.from_metadata({'session_id': 'synthetic', 'channel_key': 'test-key', 'channel': 'web', 'language': 'en'}),
        bridge=bridge, events=events, stt_provider=Provider(), tts_provider=Provider(), end_call=closed.append,
    )
    agent.test_session = Session()
    return agent, events, bridge, closed


async def completed_turn(agent, text='Synthetic utterance'):
    with pytest.raises(StopResponse):
        await asyncio.wait_for(agent.on_user_turn_completed(None, SimpleNamespace(text_content=text)), timeout=0.2)


def test_next_completed_turn_does_not_wait_for_previous_speech_playback():
    async def exercise():
        agent, events, bridge, closed = make_agent()
        await completed_turn(agent)
        first = agent.test_session.speeches[0]
        assert not first.future.done()
        await completed_turn(agent, 'Second synthetic utterance')
        assert len(bridge.turns) == 2
        assert len(agent.test_session.speeches) == 2
        assert not closed
        assert not any(kind == 'agent_state' and payload['state'] == 'listening' for kind, payload in events.sent)
        for speech in agent.test_session.speeches:
            speech.finish()
    asyncio.run(exercise())


@pytest.mark.parametrize('interrupted,new_speech,expected', [
    (False, False, ['completed']), (True, False, []), (False, True, []),
])
def test_terminal_close_waits_for_playback_and_respects_interruption(interrupted, new_speech, expected):
    async def exercise():
        agent, events, bridge, closed = make_agent(end=True)
        await completed_turn(agent)
        assert not closed
        if new_speech:
            agent.user_started_speaking()
        speech = agent.test_session.speeches[0]
        speech.finish(interrupted=interrupted)
        await asyncio.gather(*tuple(events.tasks))
        assert closed == expected
    asyncio.run(exercise())


@pytest.mark.parametrize('interrupted', [False, True])
def test_turn_limit_waits_for_scheduled_speech_completion(interrupted):
    async def exercise():
        agent, events, bridge, closed = make_agent()
        agent.max_turns = 1
        await completed_turn(agent)
        assert not closed
        agent.test_session.speeches[0].finish(interrupted=interrupted)
        await asyncio.gather(*tuple(events.tasks))
        assert closed == ['turn_limit']
    asyncio.run(exercise())


def test_new_speech_during_business_request_suppresses_stale_reply_audio():
    async def exercise():
        agent, events, bridge, closed = make_agent(end=True)
        original_turn = bridge.turn
        async def turn(*args, **kwargs):
            agent.user_started_speaking()
            return await original_turn(*args, **kwargs)
        bridge.turn = turn
        await completed_turn(agent)
        assert not agent.test_session.speeches
        assert not closed
        assert not events.tasks
    asyncio.run(exercise())


def test_retry_speech_does_not_block_completed_turn_hook():
    async def exercise():
        agent, events, bridge, closed = make_agent()
        async def turn(*args, **kwargs):
            raise RuntimeError('Synthetic backend failure')
        bridge.turn = turn
        await completed_turn(agent)
        assert len(agent.test_session.speeches) == 1
        assert not agent.test_session.speeches[0].future.done()
        assert any(kind == 'error' for kind, _ in events.sent)
        assert not closed
        agent.test_session.speeches[0].finish()
    asyncio.run(exercise())
