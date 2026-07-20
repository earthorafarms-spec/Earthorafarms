import { supabase } from "./supabase";

export async function trackPageView(pageName: string) {
  try {
    let geoData: any = null;
    try {
      const cached = sessionStorage.getItem("earthora_visitor_geo");
      if (cached) {
        geoData = JSON.parse(cached);
      } else {
        // Fetch only if not cached to prevent rate limit (429) issues
        const geoResponse = await fetch("https://ipwho.is/");
        if (geoResponse.ok) {
          geoData = await geoResponse.json();
          if (geoData && geoData.success !== false) {
            sessionStorage.setItem("earthora_visitor_geo", JSON.stringify(geoData));
          }
        }
      }
    } catch (e) {
      // Silent error handler
    }
    
    const visitor_ip = geoData?.ip || "127.0.0.1";
    const visitor_country = geoData?.country || "Localhost";
    const visitor_city = geoData?.city || "Localhost";

    const ua = navigator.userAgent;
    
    let visitor_device = "Desktop";
    if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) {
      visitor_device = "Mobile";
      if (/Tablet|iPad/i.test(ua)) {
        visitor_device = "Tablet";
      }
    }

    let visitor_os = "Unknown OS";
    if (ua.indexOf("Win") !== -1) visitor_os = "Windows";
    else if (ua.indexOf("Mac") !== -1) visitor_os = "MacOS";
    else if (ua.indexOf("X11") !== -1) visitor_os = "UNIX";
    else if (ua.indexOf("Linux") !== -1) visitor_os = "Linux";
    else if (/Android/i.test(ua)) visitor_os = "Android";
    else if (/iPhone|iPad|iPod/i.test(ua)) visitor_os = "iOS";

    let visitor_browser = "Unknown Browser";
    if (ua.indexOf("Chrome") !== -1) visitor_browser = "Chrome";
    else if (ua.indexOf("Safari") !== -1) visitor_browser = "Safari";
    else if (ua.indexOf("Firefox") !== -1) visitor_browser = "Firefox";
    else if (ua.indexOf("MSIE") !== -1) visitor_browser = "IE";
    else if (ua.indexOf("Edge") !== -1) visitor_browser = "Edge";

    await supabase
      .from("Admin_analytics")
      .insert({
        page_name: pageName,
        visitor_ip,
        visitor_device,
        visitor_os,
        visitor_browser,
        visitor_country,
        visitor_city
      });
  } catch (err) {
    // Silent error handler for database connection drops
  }
}
