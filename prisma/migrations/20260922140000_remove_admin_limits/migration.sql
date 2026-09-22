-- Los límites originales de 2 administradores ya no aplican.
-- Se eliminan triggers y funciones antiguas para permitir cualquier cantidad
-- de administradores, según la decisión del administrador principal.

DROP TRIGGER IF EXISTS "users_marketing_admin_limit" ON "users";
DROP FUNCTION IF EXISTS enforce_marketing_admin_limit();

DROP TRIGGER IF EXISTS "marketing_admin_invites_limit" ON "marketing_admin_invites";
DROP FUNCTION IF EXISTS enforce_marketing_admin_invite_limit();

DROP TRIGGER IF EXISTS "tech_admin_invites_limit" ON "tech_admin_invites";
DROP FUNCTION IF EXISTS enforce_tech_admin_invite_limit();
