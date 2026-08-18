-- Cost tracking. Real columns, not jsonb — these get charted over time,
-- and a jsonb path expression per chart is not worth it.
alter table public.inbound_graph_runs
  add column if not exists prompt_tokens integer,
  add column if not exists completion_tokens integer,
  add column if not exists llm_calls integer,
  add column if not exists llm_cost_usd numeric,
  add column if not exists search_calls integer,
  add column if not exists search_cost_usd numeric,
  add column if not exists apollo_credits integer,
  add column if not exists instantly_leads integer,
  add column if not exists total_cost_usd numeric,
  add column if not exists duration_sec integer,
  add column if not exists key_counts jsonb;

-- Per-node slice, so "the building harvest was 60% of this run" is answerable.
alter table public.inbound_graph_node_events
  add column if not exists prompt_tokens integer,
  add column if not exists completion_tokens integer,
  add column if not exists llm_calls integer,
  add column if not exists llm_cost_usd numeric,
  add column if not exists search_calls integer;
