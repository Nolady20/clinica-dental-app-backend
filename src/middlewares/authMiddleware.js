// src/middleware/authMiddleware.js
import { supabaseAnon } from '../supabaseClient.js';

export async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ error: 'Token no provisto' });

    const { data: userData, error } = await supabaseAnon.auth.getUser(token);
    if (error || !userData?.user) {
      return res.status(401).json({ error: 'Token inválido' });
    }

    req.user = userData.user; // guardamos el usuario en la request
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Error interno en middleware' });
  }
}
