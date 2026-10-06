import { useEffect, useState } from "react";
import { FileText } from "lucide-react";

export default function MarketAnalysisCard({ supabase }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data, error } = await supabase
        .from("daily_market_analysis")
        .select("id,analysis_date,metal,title,summary,bias,support,resistance,key_driver,risk_note")
        .eq("published", true)
        .order("analysis_date", { ascending: false })
        .limit(2);
      if (!cancelled && !error) setItems(data || []);
    };
    load();
    return () => { cancelled = true; };
  }, [supabase]);

  if (!items.length) return null;

  const label = (metal) => metal === "gold" ? "انس طلا" : "انس نقره";
  const biasClass = (bias) => bias === "صعودی" ? "bullish" : bias === "نزولی" ? "bearish" : "neutral";

  return (
    <section className="market-analysis-isolated" dir="rtl">
      <div className="market-analysis-isolated-head">
        <div>
          <div className="market-analysis-isolated-kicker">تحلیل روزانه</div>
          <h2>تحلیل بازار طلا و نقره</h2>
          <p>دیدگاه اختصاصی <span className="market-analysis-isolated-brand">فروشگاه میعاد</span> بر پایه داده‌های بازار جهانی</p>
        </div>
        <FileText size={22} />
      </div>
      <div className="market-analysis-isolated-list">
        {items.map((item) => (
          <article className="market-analysis-isolated-item" key={item.id}>
            <div className="market-analysis-isolated-item-head">
              <div>
                <strong>{label(item.metal)}</strong>
                <span>{item.title}</span>
              </div>
              <span className={`market-analysis-isolated-bias ${biasClass(item.bias)}`}>{item.bias || "خنثی"}</span>
            </div>
            <p>{item.summary}</p>
            <div className="market-analysis-isolated-levels">
              <span>حمایت <b>{item.support || "—"}</b></span>
              <span>مقاومت <b>{item.resistance || "—"}</b></span>
            </div>
            {item.key_driver && <div className="market-analysis-isolated-driver"><b>عامل مهم:</b> {item.key_driver}</div>}
            {item.risk_note && <div className="market-analysis-isolated-risk"><b>ریسک:</b> {item.risk_note}</div>}
          </article>
        ))}
      </div>
    </section>
  );
}
