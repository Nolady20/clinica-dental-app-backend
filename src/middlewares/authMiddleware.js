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

    const { data: usuarioRow, error: usuarioErr } = await supabaseAdmin
      .from('usuarios')
      .select('id_usuario, rol, activo')
      .eq('auth_id', authUser.id)
      .maybeSingle();

    if (usuarioErr) throw usuarioErr;

    if (!usuarioRow) {
      return res.status(401).json({ error: 'Usuario no encontrado en tabla interna' });
    }

    /** 
     * ⭐ **PERMITIMOS ELIMINAR CUENTA AUNQUE ESTÉ DESACTIVADO**
     */
    if (usuarioRow.activo === false && req.path !== "/auth/delete-account") {
      return res.status(403).json({ error: 'Tu cuenta está desactivada' });
    }

    req.user = {
      ...authUser,
      id_usuario: usuarioRow.id_usuario,
      rol: usuarioRow.rol,
      activo: usuarioRow.activo
    };

    next();
  } catch (err) {
    console.error('authMiddleware error', err);
    return res.status(500).json({
      error: 'Error interno en middleware',
      detail: err.message
    });
  }
}
