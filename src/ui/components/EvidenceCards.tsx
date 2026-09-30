import { EVIDENCE, type Evidence } from "../../core/science/evidence";
export function EvidenceCard({ source }: { source: Evidence }) {
  return <details className="vc-evidence-card" id={`source-${source.id}`}>
    <summary><span><small>{source.design}</small><strong>{source.title}</strong><span>{source.citation}</span></span><b aria-hidden="true">+</b></summary>
    <div className="vc-evidence-body"><dl>
      <div><dt>Who and what</dt><dd>{source.population}</dd></div>
      <div><dt>Finding</dt><dd>{source.finding}</dd></div>
      <div><dt>What it does not establish</dt><dd>{source.limit}</dd></div>
      <div><dt>Our design choice</dt><dd>{source.decision}</dd></div>
    </dl><p className="vc-small">{source.access} · reviewed {source.reviewed}. This is an editorial assessment, not a formal evidence grade.</p>
    <div className="vc-source-links"><a href={source.url} target="_blank" rel="noopener noreferrer">Read source ↗</a>
      {source.pmid && <a href={`https://pubmed.ncbi.nlm.nih.gov/${source.pmid}/`} target="_blank" rel="noopener noreferrer">PubMed ↗</a>}
      {source.doi && <span className="vc-small">DOI: {source.doi}</span>}
    </div></div>
  </details>;
}
export function EvidenceCards({ ids }: { ids: string[] }) {
  return <div className="vc-evidence-cards">{EVIDENCE.filter(s => ids.includes(s.id)).map(s => <EvidenceCard key={s.id} source={s}/>)}</div>;
}
