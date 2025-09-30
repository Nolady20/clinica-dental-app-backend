// src/middleware/authMiddleware.js
import { supabaseAnon, supabaseAdmin } from '../supabaseClient.js';

export async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ error: 'Token no provisto' });

    const { data: userData, error } = await supabaseAnon.auth.getUser(token);
    if (error || !userData?.user) {
      return res.status(401).json({ error: 'Token inválido' });
    }

    const authUser = userData.user;

    // Buscar en tu tabla usuarios por auth_id
    const { data: usuarioRow, error: usuarioErr } = await supabaseAdmin
      .from('usuarios')
      .select('id_usuario, rol, activo')
      .eq('auth_id', authUser.id)
      .maybeSingle();

    if (usuarioErr) throw usuarioErr;

    // Guardamos ambos en req.user
    req.user = {
      ...authUser,        // datos de Supabase (id, email, etc.)
      id_usuario: usuarioRow?.id_usuario || null, // tu id interno
      rol: usuarioRow?.rol || null,
      activo: usuarioRow?.activo ?? true,
    };

    next();
  } catch (err) {
    console.error('authMiddleware error', err);
    return res.status(500).json({ error: 'Error interno en middleware', detail: err.message });
  }
}
  
