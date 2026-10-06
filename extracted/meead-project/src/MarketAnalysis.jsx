import { useEffect, useState } from "react";
import { ChevronRight, FileText, Save, Eye, EyeOff, RefreshCw } from "lucide-react";

const EMPTY_ANALYSIS = {
  analysis_date: new Date().toISOString().slice(0, 10),
  metal: "gold",
  title: "",
  summary: "",
  bias: "خنثی",
  support: "",
  resistance: "",
  key_driver: "",
  risk_note: "",
  source_note: "",
  published: false,
};

const metalLabel = (metal) => metal === "gold" ? "انس طلا" : "انس نقره";

const faDate = (value) => {
  if (!value) return "—";
  return new Date(String(value) + "T12:00:00").toLocaleDateString("fa-IR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

function BiasBadge({ bias }) {
  const cls = bias === "صعودی" ? "market-analysis-bias bullish"
    : bias === "نزولی" ? "market-analysis-bias bearish"
    : "market-analysis-bias neutral";
  return <span className={cls}>{bias}</span>;
}

function AnalysisCard({ item, compact = false }) {
  return (
    <article className={compact ? "market-analysis-card compact" : "market-analysis-card"}>
      <div className="market-analysis-card-head">
        <div>
          <div className="market-analysis-metal">{metalLabel(item.metal)}</div>
          <h3>{item.title}</h3>
          <div className="market-analysis-date">{faDate(item.analysis_date)}</div>
        </div>
        <BiasBadge bias={item.bias} />
      </div>
      <p className="market-analysis-summary">{item.summary}</p>
      <div className="market-analysis-levels">
        <div><span>حمایت مهم</span><strong>{item.support || "—"}</strong></div>
        <div><span>مقاومت مهم</span><strong>{item.resistance || "—"}</strong></div>
      </div>
      {item.key_driver && <div className="market-analysis-driver"><strong>عامل مهم امروز</strong><span>{item.key_driver}</span></div>}
      {!compact && item.risk_note && <div className="market-analysis-risk"><strong>⚠️ ریسک مهم</strong><span>{item.risk_note}</span></div>}
      {!compact && item.source_note && <div className="market-analysis-source">{item.source_note}</div>}
    </article>
  );
}

export function MarketAnalysisTeaser({ supabase, onOpen }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data, error } = await supabase
        .from("daily_market_analysis")
        .select("*")
        .eq("published", true)
        .order("analysis_date", { ascending: false })
        .limit(2);
      if (!cancelled && !error) setItems(data || []);
    };
    load();
    return () => { cancelled = true; };
  }, [supabase]);

  if (!items.length) return null;

  return (
    <section className="market-analysis-teaser" dir="rtl">
      <div className="section-head">
        <span className="section-title">تحلیل روزانه بازار جهانی</span>
        <span className="section-caption">طلا و نقره</span>
      </div>
      <div className="market-analysis-teaser-grid">
        {items.map((item) => <AnalysisCard key={item.id} item={item} compact />)}
      </div>
      <button type="button" className="market-analysis-more" onClick={onOpen}>
        <FileText size={14} />
        مشاهده تحلیل کامل امروز
        <ChevronRight size={14} />
      </button>
    </section>
  );
}

export function MarketAnalysisPage({ supabase, onBack }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("daily_market_analysis")
      .select("*")
      .eq("published", true)
      .order("analysis_date", { ascending: false })
      .limit(20);
    if (!error) setItems(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const latestByMetal = ["gold", "silver"]
    .map((metal) => items.find((item) => item.metal === metal))
    .filter(Boolean);

  return (
    <div className="panel market-analysis-page" dir="rtl">
      <button className="back-link" onClick={onBack}><ChevronRight size={16} /> بازگشت</button>
      <div className="market-analysis-page-head">
        <div>
          <h2 className="panel-title">تحلیل روزانه بازار جهانی</h2>
          <p className="pay-note">تحلیل اختصاصی میعاد از وضعیت روز انس طلا و انس نقره</p>
        </div>
        <button type="button" className="icon-btn" onClick={load} disabled={loading} aria-label="بروزرسانی">
          <RefreshCw size={15} className={loading ? "market-analysis-spin" : ""} />
        </button>
      </div>

      {loading && <p className="pay-note">در حال دریافت آخرین تحلیل…</p>}
      {!loading && !latestByMetal.length && <div className="market-analysis-empty"><FileText size={22} /><span>تحلیل امروز هنوز منتشر نشده است.</span></div>}

      <div className="market-analysis-list">
        {latestByMetal.map((item) => <AnalysisCard key={item.id} item={item} />)}
      </div>

      {!loading && items.length > latestByMetal.length && (
        <>
          <h3 className="market-analysis-archive-title">آرشیو تحلیل‌ها</h3>
          <div className="market-analysis-list">
            {items.filter((item) => !latestByMetal.some((latest) => latest.id === item.id)).map((item) => <AnalysisCard key={item.id} item={item} compact />)}
          </div>
        </>
      )}

      <p className="market-analysis-disclaimer">این بخش صرفاً برای اطلاع‌رسانی و تحلیل بازار است و توصیه قطعی برای خرید یا فروش محسوب نمی‌شود.</p>
    </div>
  );
}

export function TabMarketAnalysis({ supabase, setToast }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(EMPTY_ANALYSIS);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("daily_market_analysis")
      .select("*")
      .order("analysis_date", { ascending: false })
      .order("metal", { ascending: true });
    if (error) setToast(error.message || "دریافت تحلیل‌ها ناموفق بود");
    else setItems(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const edit = (item) => setForm({ ...EMPTY_ANALYSIS, ...item });
  const reset = () => setForm({ ...EMPTY_ANALYSIS });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (saving) return;
    if (!form.analysis_date || !form.title.trim() || !form.summary.trim()) {
      setToast("تاریخ، عنوان و متن تحلیل الزامی است");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        analysis_date: form.analysis_date,
        metal: form.metal,
        title: form.title.trim(),
        summary: form.summary.trim(),
        bias: form.bias,
        support: form.support.trim(),
        resistance: form.resistance.trim(),
        key_driver: form.key_driver.trim(),
        risk_note: form.risk_note.trim(),
        source_note: form.source_note.trim(),
        published: !!form.published,
      };
      const { data, error } = await supabase
        .from("daily_market_analysis")
        .upsert(payload, { onConflict: "analysis_date,metal" })
        .select()
        .single();
      if (error) throw error;
      setItems((current) => [data, ...current.filter((item) => item.id !== data.id)].sort((a, b) => String(b.analysis_date).localeCompare(String(a.analysis_date)) || String(a.metal).localeCompare(String(b.metal))));
      setForm({ ...EMPTY_ANALYSIS });
      setToast(form.published ? "تحلیل منتشر شد" : "پیش‌نویس تحلیل ذخیره شد");
    } catch (error) {
      console.error("Market analysis save failed:", error);
      setToast(error?.message || "ذخیره تحلیل ناموفق بود");
    } finally {
      setSaving(false);
    }
  };

  const togglePublished = async (item) => {
    const { data, error } = await supabase
      .from("daily_market_analysis")
      .update({ published: !item.published })
      .eq("id", item.id)
      .select()
      .single();
    if (error) {
      setToast(error.message || "تغییر وضعیت انتشار ناموفق بود");
      return;
    }
    setItems((current) => current.map((row) => row.id === data.id ? data : row));
  };

  return (
    <div className="admin-section market-analysis-admin" style={{ borderTop: "none", paddingTop: 0 }}>
      <div className="market-analysis-admin-head">
        <div>
          <h3>تحلیل روزانه طلا و نقره</h3>
          <p className="pay-note">هر روز برای هر فلز یک تحلیل مستقل ثبت کنید. انتشار عمومی فقط با فعال‌کردن «انتشار» انجام می‌شود.</p>
        </div>
        <button className="ghost-btn small-btn" type="button" onClick={load} disabled={loading}><RefreshCw size={13} /> بروزرسانی</button>
      </div>

      <div className="market-analysis-editor">
        <div className="market-analysis-editor-head">
          <strong>{form.id ? "ویرایش تحلیل" : "تحلیل جدید"}</strong>
          {form.id && <button className="ghost-btn small-btn" type="button" onClick={reset}>انصراف از ویرایش</button>}
        </div>

        <div className="admin-grid">
          <label className="field"><span>تاریخ تحلیل</span><input type="date" value={form.analysis_date} onChange={(e) => update("analysis_date", e.target.value)} /></label>
          <label className="field"><span>فلز</span><select value={form.metal} onChange={(e) => update("metal", e.target.value)}><option value="gold">انس طلا</option><option value="silver">انس نقره</option></select></label>
          <label className="field" style={{ gridColumn: "1 / -1" }}><span>عنوان تحلیل</span><input value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="مثلاً تحلیل روزانه انس طلا" /></label>
        </div>

        <label className="field"><span>متن تحلیل</span><textarea className="textarea market-analysis-textarea" rows={7} value={form.summary} onChange={(e) => update("summary", e.target.value)} placeholder="تحلیل اختصاصی و تازه امروز را بنویسید…" /></label>

        <div className="admin-grid">
          <label className="field"><span>دیدگاه</span><select value={form.bias} onChange={(e) => update("bias", e.target.value)}><option>صعودی</option><option>خنثی</option><option>نزولی</option></select></label>
          <label className="field"><span>حمایت مهم</span><input value={form.support} onChange={(e) => update("support", e.target.value)} /></label>
          <label className="field"><span>مقاومت مهم</span><input value={form.resistance} onChange={(e) => update("resistance", e.target.value)} /></label>
          <label className="field"><span>عامل مهم امروز</span><input value={form.key_driver} onChange={(e) => update("key_driver", e.target.value)} /></label>
        </div>

        <label className="field"><span>ریسک مهم امروز</span><textarea className="textarea" rows={2} value={form.risk_note} onChange={(e) => update("risk_note", e.target.value)} /></label>
        <label className="field"><span>یادداشت منبع</span><input value={form.source_note} onChange={(e) => update("source_note", e.target.value)} placeholder="مثلاً بر اساس داده‌های بازار و خبرهای روز" /></label>

        <label className="toggle-row"><input type="checkbox" checked={form.published} onChange={(e) => update("published", e.target.checked)} /> انتشار عمومی در سایت</label>

        <button className="primary-btn" type="button" onClick={save} disabled={saving}><Save size={14} />{saving ? "در حال ذخیره…" : form.id ? "ذخیره تغییرات" : "ذخیره تحلیل"}</button>
      </div>

      <div className="market-analysis-admin-list">
        {loading && <p className="pay-note">در حال دریافت تحلیل‌ها…</p>}
        {!loading && !items.length && <p className="pay-note">هنوز تحلیلی ثبت نشده است.</p>}
        {items.map((item) => (
          <div className="market-analysis-admin-row" key={item.id}>
            <div>
              <div className="market-analysis-admin-row-title"><strong>{metalLabel(item.metal)}</strong><span>{faDate(item.analysis_date)}</span><BiasBadge bias={item.bias} /></div>
              <div className="market-analysis-admin-row-sub">{item.title}</div>
            </div>
            <div className="market-analysis-admin-row-actions">
              <button className="ghost-btn small-btn" type="button" onClick={() => edit(item)}>ویرایش</button>
              <button className="ghost-btn small-btn" type="button" onClick={() => togglePublished(item)}>{item.published ? <><EyeOff size={13} /> عدم انتشار</> : <><Eye size={13} /> انتشار</>}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
