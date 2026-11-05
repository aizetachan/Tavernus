/**
 * Esquema de la base (db.ts). Cada migración se aplica una vez, en orden, dentro de una transacción.
 * Nunca se cambia una ya publicada: lo nuevo va en una migración nueva con el número siguiente.
 */

export interface Migration { version: number; name: string; sql: string[] }

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'cuentas, partidas, asientos y biblioteca',
    sql: [
      `create table users (
        id uuid primary key,
        username text not null,
        username_key text not null unique,
        password_hash text not null,
        is_admin boolean not null default false,
        disabled_at timestamptz,
        created_at timestamptz not null default now(),
        last_login_at timestamptz,
        last_seen_at timestamptz
      )`,
      `create table sessions (
        id uuid primary key,
        user_id uuid not null references users (id) on delete cascade,
        token_hash text not null unique,
        created_at timestamptz not null default now(),
        last_seen_at timestamptz not null default now(),
        expires_at timestamptz not null,
        user_agent text,
        ip text
      )`,
      'create index sessions_user on sessions (user_id)',
      // El catálogo: lo que antes era game.json (que se sigue escribiendo como copia legible junto a la partida).
      `create table games (
        slug text primary key,
        name text not null,
        owner_id uuid references users (id) on delete set null,
        campaign_id text not null,
        mode text not null,
        demo boolean not null default false,
        main boolean not null default false,
        dice_seed bigint,
        world jsonb,
        character_id text,
        data_dir text not null,
        cache_dir text not null,
        initial_dir text,
        created_at timestamptz not null,
        last_opened_at timestamptz
      )`,
      'create index games_owner on games (owner_id)',
      // Biblioteca: plantillas de personaje. Cada partida guarda su propia copia en el mundo, que es la que progresa.
      `create table characters (
        id uuid primary key,
        user_id uuid not null references users (id) on delete cascade,
        name text not null,
        race_id text,
        class_id text,
        background_id text,
        abilities jsonb,
        skills jsonb,
        hook text,
        appearance text,
        death_mode text not null default 'casual',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      'create index characters_user on characters (user_id)',
      `create table seats (
        id text primary key,
        game_slug text not null references games (slug) on delete cascade,
        token text not null,
        label text not null,
        is_host boolean not null default false,
        character_id text,
        user_id uuid references users (id) on delete set null,
        template_id uuid references characters (id) on delete set null,
        created_at timestamptz not null default now(),
        last_seen_at timestamptz,
        unique (game_slug, user_id)
      )`,
      'create index seats_game on seats (game_slug)',
      'create index seats_user on seats (user_id)',
      `create table admin_log (
        id bigserial primary key,
        admin_id uuid references users (id) on delete set null,
        admin_name text not null,
        action text not null,
        target text,
        detail jsonb,
        at timestamptz not null default now()
      )`,
    ],
  },
];
