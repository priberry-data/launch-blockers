create table public.notes (id bigint primary key, owner uuid not null default auth.uid(), body text);
alter table public.notes enable row level security;
create policy "owner reads" on public.notes for select using (auth.uid() = owner);
create policy "owner writes" on public.notes for insert with check (auth.uid() = owner);
