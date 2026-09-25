-- What a thread has cost so far, and how full the model's context was on its
-- last call. Every OpenRouter call on the thread adds to cost_usd, including
-- the proposal service's. context_tokens / context_limit are the chat model's.

alter table public.hq_threads
  add column if not exists cost_usd numeric not null default 0;

alter table public.hq_threads
  add column if not exists context_tokens integer;

alter table public.hq_threads
  add column if not exists context_limit integer;
