# Guia do Supabase — fundação de contas + créditos + vouchers (ComparaCam)

Objetivo desta fase: **login** + **saldo de créditos no servidor** (autoritativo) +
**vouchers** que parceiros (labs / material hospitalar) compram e o médico resgata.

> **Privacidade:** as **fotos dos pacientes continuam SÓ no aparelho** (IndexedDB).
> Nada de foto vai para o servidor — apenas conta, saldo e vouchers.

Modelo de monetização priorizado (B2B):
1. **Vouchers** de crédito vendidos a parceiros → médico resgata no app.
2. **Patrocínio/banner** vendido a parceiros.
3. Compra avulsa do médico (Mercado Pago) — entra quando houver CNPJ/MEI + conta MP.
4. ~~Anúncio recompensado de loja~~ — descartado (PWA não usa SDK de loja; nicho = receita ~zero; IAP tomaria 15–30%).

---

## Parte 1 — Criar o projeto (você faz, ~5 min)
1. Acesse **supabase.com** → *Start your project* → entre com GitHub ou e-mail.
2. *New project*:
   - **Name:** `comparacam`
   - **Database Password:** gere uma senha forte e **guarde** (não compartilhe).
   - **Region:** *South America (São Paulo)*.
   - **Plan:** Free.
3. Espere ~2 min provisionar.

## Parte 2 — Pegar as chaves
- Menu **Settings (engrenagem) → API**.
- **Públicas (podem ser compartilhadas / ficam no app):** `Project URL` e a `anon public` key.
- **SECRETAS (nunca compartilhar):** `service_role` key e a senha do banco. Elas só
  vão em variáveis de ambiente / *secrets* das Edge Functions do próprio Supabase.

## Parte 3 — Ligar o login por e-mail (link mágico, sem senha)
- **Authentication → Providers → Email:** habilite.
- **Authentication → URL Configuration:** em *Site URL* e *Redirect URLs*, coloque
  `https://criadorcardeal.github.io/Camera-Fantasma/`.

## Parte 4 — Criar as tabelas (SQL)
Em **SQL Editor → New query**, cole e clique **Run**.

```sql
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text, created_at timestamptz default now());

create table public.wallets (
  user_id uuid primary key references auth.users on delete cascade,
  balance int not null default 0 check (balance >= 0),
  updated_at timestamptz default now());

create table public.credit_transactions (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  delta int not null, reason text not null, ref text,
  created_at timestamptz default now());

create table public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null, cnpj text, contact text,
  created_at timestamptz default now());

create table public.voucher_batches (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references public.partners,
  credits_each int not null, note text,
  created_at timestamptz default now());

create table public.vouchers (
  code text primary key,
  batch_id uuid references public.voucher_batches,
  credits int not null,
  status text not null default 'active',       -- 'active' | 'redeemed'
  redeemed_by uuid references auth.users,
  redeemed_at timestamptz, expires_at timestamptz,
  created_at timestamptz default now());

alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.vouchers enable row level security;
alter table public.partners enable row level security;
alter table public.voucher_batches enable row level security;

create policy "perfil proprio"   on public.profiles            for select using (auth.uid() = id);
create policy "carteira propria" on public.wallets             for select using (auth.uid() = user_id);
create policy "extrato proprio"  on public.credit_transactions for select using (auth.uid() = user_id);
-- vouchers / partners / voucher_batches: sem policy de SELECT p/ usuário comum
-- (acesso só via função redeem_voucher ou pelo painel admin com service_role).

-- Resgate seguro e atômico do voucher (valida + credita)
create or replace function public.redeem_voucher(p_code text)
returns int language plpgsql security definer set search_path = public as $$
declare v_credits int; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'nao autenticado'; end if;
  update public.vouchers set status='redeemed', redeemed_by=v_uid, redeemed_at=now()
   where code=p_code and status='active' and (expires_at is null or expires_at>now())
  returning credits into v_credits;
  if v_credits is null then raise exception 'voucher invalido ou ja usado'; end if;
  insert into public.wallets(user_id,balance) values (v_uid,v_credits)
    on conflict (user_id) do update set balance=public.wallets.balance+excluded.balance, updated_at=now();
  insert into public.credit_transactions(user_id,delta,reason,ref) values (v_uid,v_credits,'voucher',p_code);
  return v_credits;
end $$;

-- Cria carteira/perfil automaticamente ao cadastrar
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id) values (new.id) on conflict do nothing;
  insert into public.wallets(user_id,balance) values (new.id,0) on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
```

**Por que é seguro:** o saldo (`wallets`) só muda por funções do servidor; o usuário
**lê só o próprio** saldo/extrato (RLS); o voucher é validado por **consulta no banco**
(existe? ativo? não venceu?) e creditado de forma **atômica** — à prova de uso duplo/fraude,
sem precisar de nada "cripto".

## Parte 5 — O que o desenvolvimento faz depois (precisa de `Project URL` + `anon key`)
1. **Login no app** por link mágico + tela de conta.
2. **Migrar os créditos** do `localStorage` para o servidor (ler saldo; reservar/confirmar
   via função). Remove o PIN `1234` inseguro.
3. **Resgatar voucher** no app (chama `redeem_voucher`).
4. **Painel simples** para criar parceiros e gerar lotes de vouchers (admin, via `service_role`
   numa Edge Function ou direto no dashboard).
5. (Mais tarde, com CNPJ/MEI + conta Mercado Pago) **webhook de pagamento** — plugável
   nessa mesma base, para a compra avulsa do médico.

---

## Pendências fora do código (responsabilidade do dono do produto)
- **CNPJ/MEI** e **conta Mercado Pago empresarial** (para receber e emitir nota).
- **Termos de Uso + Política de Privacidade** e conformidade **LGPD**.
- Regras de propaganda médica (Anvisa/CFM) caso use patrocínio de indústria.
