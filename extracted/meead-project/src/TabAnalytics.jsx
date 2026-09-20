import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchSiteAnalytics } from "./siteAnalytics";

function formatDay(value) {
  return new Date(value).toLocaleDateString("fa-IR", {
    day: "numeric",
    month: "long",
  });
}

function formatHour(value) {
  return new Date(value).toLocaleTimeString("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("fa-IR");
}

function AnalyticsRow({ label, row }) {
  return (
    <div
      className="history-row"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(64px, 0.7fr) 1fr 1fr",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderRadius: 12,
      }}
    >
      <span className="mono" style={{ fontWeight: 700 }}>
        {label}
      </span>

      <span
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          minWidth: 0,
          textAlign: "center",
        }}
      >
        <strong>{formatNumber(row.uniqueVisitors)}</strong>
        <span style={{ opacity: 0.65, fontSize: 12 }}>یکتا</span>
      </span>

      <span
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          minWidth: 0,
          textAlign: "center",
        }}
      >
        <strong>{formatNumber(row.events)}</strong>
        <span style={{ opacity: 0.65, fontSize: 12 }}>بازدید</span>
      </span>
    </div>
  );
}

function AnalyticsSection({ title, subtitle, rows, emptyText, formatter }) {
  return (
    <div
      className="admin-section"
      style={{
        marginTop: 18,
        padding: 0,
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "16px 16px 10px" }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <div className="section-caption" style={{ marginTop: 4 }}>
          {subtitle}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="pay-note" style={{ margin: "0 16px 16px" }}>
          {emptyText}
        </div>
      ) : (
        <div style={{ padding: "0 8px 8px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(64px, 0.7fr) 1fr 1fr",
              gap: 12,
              padding: "0 14px 8px",
              fontSize: 11,
              opacity: 0.55,
            }}
          >
            <span />
            <span style={{ textAlign: "center" }}>بازدیدکننده یکتا</span>
            <span style={{ textAlign: "center" }}>تعداد بازدید</span>
          </div>

          {rows.map((row) => (
            <AnalyticsRow
              key={row.bucket}
              label={formatter(row.bucket)}
              row={row}
            />
          ))}
        </div>
      )}
    </div>
  );
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
              <span className="stat-value mono">
                {formatNumber(data?.summary?.todayUniqueVisitors)}
              </span>
            </div>

            <div className="stat-card">
              <span className="stat-label">بازدیدکننده یکتا در ۲۴ ساعت</span>
              <span className="stat-value mono">
                {formatNumber(data?.summary?.last24UniqueVisitors)}
              </span>
            </div>

            <div className="stat-card">
              <span className="stat-label">بازدید امروز</span>
              <span className="stat-value mono">
                {formatNumber(data?.summary?.todayEvents)}
              </span>
            </div>

            <div className="stat-card">
              <span className="stat-label">بازدید در ۲۴ ساعت</span>
              <span className="stat-value mono">
                {formatNumber(data?.summary?.last24Events)}
              </span>
            </div>
          </div>

          <AnalyticsSection
            title="بازدید ساعتی"
            subtitle="۲۴ ساعت اخیر"
            rows={recentHours}
            emptyText="هنوز داده‌ای ثبت نشده است."
            formatter={formatHour}
          />

          <AnalyticsSection
            title="بازدید روزانه"
            subtitle="۷ روز اخیر"
            rows={daily}
            emptyText="هنوز داده‌ای ثبت نشده است."
            formatter={formatDay}
          />

          <p className="admin-footnote">
            آمار «بازدیدکننده یکتا» بر اساس یک شناسه تصادفی ذخیره‌شده در همان مرورگر محاسبه می‌شود؛ ورود یا ثبت‌نام مشتری لازم نیست.
          </p>
        </>
      )}
    </div>
  );
}
