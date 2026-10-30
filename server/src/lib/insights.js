// Rule-based insights. Every item states its metric, value, comparison, period and method. No invented numbers.
import { aggregate, withGrowth, catOf, inr, fmtDate, summarize, UNCAT, pct } from './analytics.js';

export function generateInsights({ cur, prev, periodText, prevText, flags, settings = {} }) {
  const items = [], unavailable = [];
  const add = (o) => items.push(o);
  const skip = (id, title, reason) => unavailable.push({ id, title, reason });
  if (!cur.length) return { insights: [], unavailable: [{ id: 'all', title: 'All insights', reason: 'There is no sales data for the selected filters.' }] };
  const sum = summarize(cur);
  const total = sum.netSales;

  // overall change
  if (prev) {
    const ps = summarize(prev);
    const ch = pct(sum.netSales, ps.netSales);
    if (ch !== null) add({ id: 'overall', priority: 90, title: `Net sales ${ch >= 0 ? 'rose' : 'fell'} ${Math.abs(ch)}% versus the previous period`,
      text: `Net sales were ${inr(sum.netSales)} in ${periodText}, compared with ${inr(ps.netSales)} in ${prevText}.`, metric: 'Net sales', value: inr(sum.netSales), comparison: `${ch >= 0 ? '+' : ''}${ch}% vs ${inr(ps.netSales)}`, dateRange: periodText, method: 'Sum of net sales (returns deducted) for the selected period divided against the immediately preceding period of equal length.' });
  } else skip('overall', 'Change versus previous period', 'Needs a date range (or a preset like Last 90 days) with an equally long earlier period inside your data.');

  // concentration
  const shops = aggregate(cur.filter((t) => t.shopKey), (t) => t.shopKey, (t) => t.shopName);
  if (shops.length >= 6) {
    const k = Math.min(5, shops.length), topNet = shops.slice(0, k).reduce((s, x) => s + x.net, 0);
    const share = Math.round((topNet / total) * 100);
    add({ id: 'concentration', priority: 80, title: `The top ${k} shops contributed ${share}% of sales`, text: `The top ${k} of ${shops.length} shops (${shops.slice(0, k).map((s) => s.label).join(', ')}) generated ${inr(topNet)} of ${inr(total)} in ${periodText}.`, metric: 'Top-5 shop share', value: `${share}%`, comparison: `${inr(topNet)} of ${inr(total)}`, dateRange: periodText, method: 'Shops ranked by net sales; the five highest are summed and divided by total net sales.' });
  } else skip('concentration', 'Top-shop concentration', `Needs at least 6 shops; found ${shops.length}.`);

  // areas
  const withArea = cur.filter((t) => t.area);
  if (withArea.length) {
    const areas = aggregate(withArea, (t) => t.area, (t) => t.area);
    const a = areas[0], b = areas[1];
    add({ id: 'top-area', priority: 75, title: `${a.label} is the top area`, text: `${a.label} generated ${inr(a.net)} in net sales (${a.share}% of total with an area) in ${periodText}${b ? `; next is ${b.label} with ${inr(b.net)}` : ''}.`, metric: 'Area net sales', value: inr(a.net), comparison: b ? `${b.label}: ${inr(b.net)}` : 'only one area', dateRange: periodText, method: 'Net sales grouped by the imported area field.' });
    // more shops but lower avg per shop
    let best = null;
    for (const x of areas) for (const y of areas) {
      if (x === y || x.shops < 2 || y.shops <= x.shops) continue;
      const ax = x.net / x.shops, ay = y.net / y.shops;
      if (ay < ax * 0.8) { const gap = ax - ay; if (!best || gap > best.gap) best = { x, y, ax, ay, gap }; }
    }
    if (best) add({ id: 'area-productivity', priority: 55, title: `${best.y.label} has more shops but lower sales per shop than ${best.x.label}`, text: `${best.y.label}: ${best.y.shops} shops averaging ${inr(best.ay)} each. ${best.x.label}: ${best.x.shops} shops averaging ${inr(best.ax)} each (${periodText}). This is an observation, not a diagnosis of the cause.`, metric: 'Average net sales per purchasing shop', value: inr(best.ay), comparison: `${best.x.label}: ${inr(best.ax)}`, dateRange: periodText, method: 'Area net sales divided by number of distinct shops with positive sales in that area.' });
  } else skip('top-area', 'Area performance', 'No area values were imported.');

  // categories
  const cats = aggregate(cur, catOf);
  const known = cats.filter((c) => c.key !== UNCAT);
  if (known.length) {
    const c = known[0];
    add({ id: 'top-category', priority: 70, title: `${c.label} contributed ${Math.round(c.net / total * 100)}% of revenue`, text: `${c.label} generated ${inr(c.net)} of ${inr(total)} in ${periodText}.`, metric: 'Category share', value: `${Math.round(c.net / total * 100)}%`, comparison: known[1] ? `${known[1].label}: ${Math.round(known[1].net / total * 100)}%` : '', dateRange: periodText, method: 'Net sales by category divided by total net sales.' });
  } else skip('top-category', 'Category performance', 'All sales are Uncategorized. Map a category column or assign categories to products.');

  // product / category growth
  if (prev) {
    const pg = withGrowth(aggregate(cur.filter((t) => t.productKey), (t) => t.productKey, (t) => t.productName), aggregate(prev.filter((t) => t.productKey), (t) => t.productKey))
      .filter((p) => p.prevNet > 0 && p.changePct !== null && Math.abs(p.net) >= total * 0.01);
    const up = [...pg].sort((a, b) => b.change - a.change)[0], down = [...pg].sort((a, b) => a.change - b.change)[0];
    if (up && up.changePct >= 10) add({ id: 'product-up', priority: 65, title: `${up.label} sales increased ${up.changePct}%`, text: `${up.label} sales went from ${inr(up.prevNet)} to ${inr(up.net)} (${periodText} vs ${prevText}).`, metric: 'Product net sales', value: inr(up.net), comparison: `+${up.changePct}% vs ${inr(up.prevNet)}`, dateRange: periodText, method: 'Product net sales compared with the previous period of equal length; products below 1% of sales ignored.' });
    if (down && down.changePct <= -10) add({ id: 'product-down', priority: 68, title: `${down.label} sales declined ${Math.abs(down.changePct)}%`, text: `${down.label} sales went from ${inr(down.prevNet)} to ${inr(down.net)} (${periodText} vs ${prevText}).`, metric: 'Product net sales', value: inr(down.net), comparison: `${down.changePct}% vs ${inr(down.prevNet)}`, dateRange: periodText, method: 'Product net sales compared with the previous period of equal length; products below 1% of sales ignored.' });
    const overall = pct(sum.netSales, summarize(prev).netSales);
    const cg = withGrowth(cats, aggregate(prev, catOf)).filter((c) => c.key !== UNCAT && c.prevNet > 0 && c.prevNet >= summarize(prev).netSales * 0.05);
    const grower = [...cg].sort((a, b) => b.changePct - a.changePct)[0];
    if (grower && grower.changePct >= 10 && overall !== null && Math.abs(overall) < 5) add({ id: 'category-growing', priority: 62, title: `${grower.label} is growing while overall sales are flat`, text: `${grower.label} grew ${grower.changePct}% (${inr(grower.prevNet)} → ${inr(grower.net)}) while total net sales changed ${overall}%.`, metric: 'Category growth', value: `+${grower.changePct}%`, comparison: `overall ${overall}%`, dateRange: periodText, method: 'Category net sales vs previous period; "flat" means total moved less than 5%.' });
  } else skip('product-trends', 'Product and category growth/decline', 'Needs an earlier period of equal length inside your data to compare against.');

  // shops follow-up
  if (flags && flags.inactive) {
    if (flags.inactive.length) add({ id: 'inactive', priority: 85, title: `${flags.inactive.length} shop${flags.inactive.length > 1 ? 's have' : ' has'} not purchased in ${flags.thresholdDays}+ days`, text: `Measured to the latest sale date (${fmtDate(flags.asOf)}). Largest by lifetime sales: ${flags.inactive.slice(0, 3).map((s) => `${s.shopName} (${inr(s.lifetimeNet)})`).join(', ')}. Treat this as a follow-up suggestion, not a prediction.`, metric: 'Shops with no recent purchase', value: String(flags.inactive.length), comparison: `threshold ${flags.thresholdDays} days`, dateRange: `up to ${fmtDate(flags.asOf)}`, method: 'Days between a shop\'s last non-return purchase and the latest sale date in the data.' });
    flags.declining.slice(0, 2).forEach((s, i) => add({ id: 'decline-' + i, priority: 72 - i, title: `${s.shopName} sales declined ${Math.abs(s.changePct)}%`, text: `${s.shopName} bought ${inr(s.recentNet)} in the last ${flags.thresholdDays} days versus ${inr(s.priorNet)} in the ${flags.thresholdDays} days before.`, metric: 'Shop net sales', value: inr(s.recentNet), comparison: `${s.changePct}% vs ${inr(s.priorNet)}`, dateRange: `last ${flags.thresholdDays} days to ${fmtDate(flags.asOf)}`, method: 'Net sales in the latest window compared with the preceding window of equal length.' }));
  }
  if (flags && flags.notes?.length) skip('shop-flags', 'Inactive / declining shop flags', flags.notes[0]);

  // returns
  if (sum.returns > 0) add({ id: 'returns', priority: 50, title: `Returns were ${inr(sum.returns)}`, text: `Returns/refunds of ${inr(sum.returns)} were deducted from sales before reaching net sales of ${inr(sum.netSales)} (${periodText}).`, metric: 'Returns', value: inr(sum.returns), comparison: `${Math.round((sum.returns / (sum.netSales + sum.returns)) * 100)}% of sales before returns`, dateRange: periodText, method: 'Sum of rows flagged as returns (negative quantity or amount).' });
  if (sum.rowsWithoutDate) skip('undated', 'Undated rows', `${sum.rowsWithoutDate} rows have no date; they are included in totals but excluded from trends and comparisons.`);

  items.sort((a, b) => b.priority - a.priority);
  return { insights: items.slice(0, 12), unavailable };
}
