-- Each stage already writes its own inbound_graph_runs row. This links the stages of
-- one end-to-end pipeline execution so a trace can be read as a single unit.
alter table public.inbound_graph_runs
  add column if not exists pipeline_id uuid,
  add column if not exists stage_no integer;

create index if not exists inbound_graph_runs_pipeline_idx
  on public.inbound_graph_runs(pipeline_id, stage_no);
create index if not exists inbound_graph_runs_company_started_idx
  on public.inbound_graph_runs(company_id, started_at desc);
