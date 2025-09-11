// src/controllers/authController.js
import { supabaseAdmin, supabaseAnon } from '../supabaseClient.js';

export async function register(req, res) {
  try {
    const { correo, password, dni, rol } = req.body;
    if (!correo || !password || !dni || !rol) {
      return res.status(400).json({ error: 'Faltan campos: correo, password, dni, rol' });
    }

    // 1) Validar si ya existe un usuario con ese DNI
    const { data: usuarioExistente, error: dniErr } = await supabaseAdmin
      .from('usuarios')
      .select('id_usuario')
      .eq('dni', dni)
      .maybeSingle();

    if (dniErr) {
      console.error('Error verificando DNI:', dniErr);
      return res.status(500).json({ error: 'Error verificando DNI' });
    }
    if (usuarioExistente) {
      return res.status(400).json({ error: 'El DNI ya está registrado' });
    }

    // 2) Crear usuario en Supabase Auth (admin)
    const { data: createData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: correo,
      password,
      email_confirm: true
    });

    if (createErr) {
      console.error('Error creando usuario en auth:', createErr);
      return res.status(400).json({ error: createErr.message });
    }

    const auth_id = createData.user?.id;
    if (!auth_id) {
      return res.status(500).json({ error: 'No se pudo obtener auth_id' });
    }

    // 3) Insertar en tabla usuarios
    const { error: insertErr } = await supabaseAdmin
      .from('usuarios')
      .insert([{ auth_id, dni, correo, rol }]);

    if (insertErr) {
      console.error('Error insertando en usuarios:', insertErr);
      // Rollback: borrar al usuario en Auth
      await supabaseAdmin.auth.admin.deleteUser(auth_id);
      return res.status(500).json({ error: insertErr.message });
    }

    return res.json({ ok: true, auth_id });
  } catch (err) {
    console.error('register error', err);
    return res.status(500).json({ error: 'Error interno en register' });
  }
}

export async function login(req, res) {
  try {
    const { dni, password } = req.body;
    if (!dni || !password) return res.status(400).json({ error: 'Faltan campos: dni, password' });

    // 1) Buscar correo por DNI
    const { data: usuario, error: uErr } = await supabaseAdmin
      .from('usuarios')
      .select('*')
      .eq('dni', dni)
      .maybeSingle();

    if (uErr) {
      console.error('Error buscando usuario por dni:', uErr);
      return res.status(500).json({ error: 'Error buscando usuario' });
    }
    if (!usuario) {
      return res.status(401).json({ error: 'DNI o contraseña inválidos' });
    }

    // 2) Login con correo y contraseña usando supabaseAnon
    const { data: signInData, error: signInErr } = await supabaseAnon.auth.signInWithPassword({
      email: usuario.correo,
      password
    });

    if (signInErr) {
      console.error('Error en signInWithPassword:', signInErr);
      return res.status(401).json({ error: 'DNI o contraseña inválidos' });
    }

    // 3) Filtrar la info a devolver

    return res.json({
      ok: true,
      session: {
        access_token: signInData.session.access_token,
        refresh_token: signInData.session.refresh_token, // <-- agregado
        expires_in: signInData.session.expires_in
      },
      user: {
        id: signInData.user.id,
        email: signInData.user.email,
        rol: usuario.rol
      },
      profile: {
        id_usuario: usuario.id_usuario,
        dni: usuario.dni,
        correo: usuario.correo,
        rol: usuario.rol,
        creado_en: usuario.creado_en
      }
    });

  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ error: 'Error interno en login' });
  }
}

export async function me(req, res) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ error: 'Token no provisto' });

    const { data: userData, error: getUserErr } = await supabaseAnon.auth.getUser(token);
    if (getUserErr || !userData?.user) {
      return res.status(401).json({ error: 'Token inválido' });
    }

    const authUser = userData.user;
    const { data: profile, error: profErr } = await supabaseAdmin
      .from('usuarios')
      .select('*')
      .eq('auth_id', authUser.id)
      .maybeSingle();

    if (profErr) {
      return res.status(500).json({ error: 'Error consultando perfil' });
    }

    return res.json({
      ok: true,
      user: {
        id: authUser.id,
        email: authUser.email,
        rol: profile.rol
      },
      profile: {
        id_usuario: profile.id_usuario,
        dni: profile.dni,
        correo: profile.correo,
        rol: profile.rol,
        creado_en: profile.creado_en
      }
    });
  } catch (err) {
    console.error('me error', err);
    return res.status(500).json({ error: 'Error interno en me' });
  }
}
