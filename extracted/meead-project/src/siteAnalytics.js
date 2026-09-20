const VISITOR_KEY = "meead-analytics-visitor-id";
const SESSION_KEY = "meead-analytics-session-id";

function getUuid(storage, key) {
  try {
    const existing = storage.getItem(key);
    if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) {
      return existing;
    }
    const id = crypto.randomUUID();
    storage.setItem(key, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export async function trackSiteVisit(supabase) {
  if (typeof window === "undefined") return;

  try {
    const visitorId = getUuid(window.localStorage, VISITOR_KEY);
    const sessionId = getUuid(window.sessionStorage, SESSION_KEY);

    await supabase.functions.invoke("site-analytics", {
      body: {
        visitorId,
        sessionId,
        pagePath: window.location.pathname || "/",
      },
    });
  } catch (error) {
    // Analytics must never block or break the storefront.
    console.warn("Meead analytics unavailable:", error);
  }
}

export async function fetchSiteAnalytics(supabase, days = 7) {
  const safeDays = Math.min(Math.max(Number(days) || 7, 1), 31);
  const to = new Date();
  const from = new Date(to.getTime() - safeDays * 24 * 60 * 60 * 1000);
  const timeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tehran";

  const { data, error } = await supabase.rpc("get_site_analytics", {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_timezone: timeZone,
  });

  if (error) throw error;
  if (!data?.ok) {
    throw new Error(data?.reason || "دریافت آمار بازدید ناموفق بود");
  }

  return {
    ...data,
    timeZone,
  };
}
