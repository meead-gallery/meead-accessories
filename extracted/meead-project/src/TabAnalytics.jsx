import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchSiteAnalytics } from "./siteAnalytics";

function formatDay(value) {
  return new Date(value).toLocaleDateString("fa-IR", {
    month: "2-digit",
    day: "2-digit",
  });
}

function formatHour(value) {
  return new Date(value).toLocaleTimeString("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TabAnalytics({ supabase, setToast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchSiteAnalytics(supabase, 7);
      setData(next);
    } catch (error) {
      console.error("Site analytics load failed:", error);
      setToast(error?.message || "دریافت آمار بازدید ناموفق بود");
    } finally {
      setLoading(false);
    }
  }, [supabase, setToast]);

  useEffect(() => {
    load();
  }, [load]);

  const recentHours = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return (data?.hourly || [])
      .filter((row) => new Date(row.bucket).getTime() >= cutoff)
      .slice(-24)
      .reverse();
  }, [data]);

  const daily = [...(data?.daily || [])].reverse();

  return (
    <div className="admin-section" style={{ borderTop: "none", paddingTop: 0 }}>
      <div className="section-head" style={{ padding: 0 }}>
        <div>
          <div className="section-title">آمار بازدید سایت</div>
          <div className="section-caption">
            بدون ثبت‌نام و بدون نمایش چیزی به مشتری
          </div>
        </div>
        <button className="ghost-btn small-btn" onClick={load} disabled={loading}>
          {loading ? "در حال بروزرسانی…" : "بروزرسانی"}
        </button>
      </div>

      {loading && !data ? (
        <div className="pay-note">در حال دریافت آمار…</div>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <span className="stat-label">بازدیدکننده یکتا امروز</span>
              <span className="stat-value mono">{Number(data?.summary?.todayUniqueVisitors || 0).toLocaleString("fa-IR")}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">بازدیدکننده یکتا در ۲۴ ساعت</span>
              <span className="stat-value mono">{Number(data?.summary?.last24UniqueVisitors || 0).toLocaleString("fa-IR")}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">حضورهای ثبت‌شده امروز</span>
              <span className="stat-value mono">{Number(data?.summary?.todayEvents || 0).toLocaleString("fa-IR")}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">حضورهای ثبت‌شده ۲۴ ساعت</span>
              <span className="stat-value mono">{Number(data?.summary?.last24Events || 0).toLocaleString("fa-IR")}</span>
            </div>
          </div>

          <div className="admin-section">
            <h3>ساعت به ساعت — ۲۴ ساعت اخیر</h3>
            <div className="history-list">
              {recentHours.length === 0 ? (
                <span className="pay-note">هنوز داده‌ای ثبت نشده است.</span>
              ) : (
                recentHours.map((row) => (
                  <div className="history-row" key={row.bucket}>
                    <span className="mono">{formatHour(row.bucket)}</span>
                    <span> {Number(row.uniqueVisitors || 0).toLocaleString("fa-IR")} نفر یکتا · {Number(row.events || 0).toLocaleString("fa-IR")} حضور</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="admin-section">
            <h3>روز به روز — ۷ روز اخیر</h3>
            <div className="history-list">
              {daily.length === 0 ? (
                <span className="pay-note">هنوز داده‌ای ثبت نشده است.</span>
              ) : (
                daily.map((row) => (
                  <div className="history-row" key={row.bucket}>
                    <span className="mono">{formatDay(row.bucket)}</span>
                    <span> {Number(row.uniqueVisitors || 0).toLocaleString("fa-IR")} نفر یکتا · {Number(row.events || 0).toLocaleString("fa-IR")} حضور</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <p className="admin-footnote">
            آمار «بازدیدکننده یکتا» بر اساس یک شناسه تصادفی ذخیره‌شده در همان مرورگر محاسبه می‌شود؛ ورود یا ثبت‌نام مشتری لازم نیست.
          </p>
        </>
      )}
    </div>
  );
}
