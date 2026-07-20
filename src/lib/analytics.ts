import { supabase } from "./supabase";

export async function trackPageView(pageName: string) {
  try {
    let visitor_ip = "127.0.0.1";
    let visitor_country = "Localhost";
    let visitor_city = "Localhost";

    // Only fetch geo-ip in production to avoid rate-limit (429) errors during development.
    // React StrictMode fires effects twice, exhausting free API quotas instantly.
    if (import.meta.env.PROD) {
      try {
        const cached = sessionStorage.getItem("earthora_visitor_geo");
        if (cached) {
          const geoData = JSON.parse(cached);
          visitor_ip = geoData?.ip || visitor_ip;
          visitor_country = geoData?.country || visitor_country;
          visitor_city = geoData?.city || visitor_city;
        } else {
          const geoResponse = await fetch("https://ipwho.is/");
          if (geoResponse.ok) {
            const geoData = await geoResponse.json();
            if (geoData && geoData.success !== false) {
              sessionStorage.setItem("earthora_visitor_geo", JSON.stringify(geoData));
              visitor_ip = geoData?.ip || visitor_ip;
              visitor_country = geoData?.country || visitor_country;
              visitor_city = geoData?.city || visitor_city;
            }
          }
        }
      } catch (_) {
        // Silent fallback — geo-ip is non-critical
      }
    }

    const ua = navigator.userAgent;

    let visitor_device = "Desktop";
    if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) {
      visitor_device = /Tablet|iPad/i.test(ua) ? "Tablet" : "Mobile";
    }

    let visitor_os = "Unknown OS";
    if (ua.indexOf("Win") !== -1) visitor_os = "Windows";
    else if (ua.indexOf("Mac") !== -1) visitor_os = "MacOS";
    else if (/Android/i.test(ua)) visitor_os = "Android";
    else if (/iPhone|iPad|iPod/i.test(ua)) visitor_os = "iOS";
    else if (ua.indexOf("Linux") !== -1) visitor_os = "Linux";
    else if (ua.indexOf("X11") !== -1) visitor_os = "UNIX";

    let visitor_browser = "Unknown Browser";
    if (ua.indexOf("Edg") !== -1) visitor_browser = "Edge";
    else if (ua.indexOf("Chrome") !== -1) visitor_browser = "Chrome";
    else if (ua.indexOf("Firefox") !== -1) visitor_browser = "Firefox";
    else if (ua.indexOf("Safari") !== -1) visitor_browser = "Safari";
    else if (ua.indexOf("MSIE") !== -1 || ua.indexOf("Trident") !== -1) visitor_browser = "IE";

    await supabase
      .from("Admin_analytics")
      .insert({
        page_name: pageName,
        visitor_ip,
        visitor_device,
        visitor_os,
        visitor_browser,
        visitor_country,
        visitor_city,
      });
  } catch (_) {
    // Silent error handler — analytics failures must never break the UI
  }
}
