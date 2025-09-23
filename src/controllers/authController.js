// src/controllers/authController.js
import { supabaseAdmin, supabaseAnon } from '../supabaseClient.js';

// 👉 Función auxiliar para formatear fecha (dd/MM/yyyy → yyyy-MM-dd)
function formatDate(dateStr) {
  if (!dateStr) return null;
  const [day, month, year] = dateStr.split('/');
  return `${year}-${month}-${day}`;
}

// 👉 Helper para construir respuesta consistente
function buildResponse(user, session, paciente = null) {
  return {
    ok: true,
    ...(session ? {
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in
      }
    } : {}),
    user: {
      id: user.id,
      email: user.email,
      rol: user.rol
    },
    profile: {
      id_usuario: user.id_usuario,
      correo: user.correo,
      rol: user.rol,
      creado_en: user.creado_en,
      ...(paciente ? {
        id_paciente: paciente.id_paciente,
        numero_documento: paciente.numero_documento,
        tipo_documento: paciente.tipo_documento,
        nombre: paciente.nombre,
        ape_pat: paciente.ape_pat,
        ape_mat: paciente.ape_mat,
        fecha_nacimiento: paciente.fecha_nacimiento,
        telefono: paciente.telefono,
        sexo: paciente.sexo
      } : {})
    }
  };
}

export async function register(req, res) {
  try {
    const { 
      correo, 
      password, 
      numero_documento, 
      tipo_documento = 'DNI', 
      rol, 
      nombre, 
      ape_pat, 
      ape_mat, 
      fecha_nacimiento, 
      telefono, 
      sexo 
    } = req.body;

    if (!correo || !password || !numero_documento || !rol) {
      return res.status(400).json({ error: 'Faltan campos obligatorios: correo, password, numero_documento, rol' });
    }

    // 1) Verificar si ya existe paciente con ese documento
    const { data: pacienteExistente, error: docErr } = await supabaseAdmin
      .from('pacientes')
      .select('*')
      .eq('numero_documento', numero_documento)
      .eq('tipo_documento', tipo_documento)
      .maybeSingle();

    if (docErr) {
      console.error('Error verificando documento:', docErr);
      return res.status(500).json({ error: 'Error verificando documento' });
    }

    // Si ya existe y tiene usuario → error
    if (pacienteExistente && pacienteExistente.id_usuario) {
      return res.status(400).json({ error: 'El documento ya está registrado con una cuenta' });
    }

    // 2) Crear usuario en Supabase Auth
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
    const { data: userRow, error: insertErr } = await supabaseAdmin
      .from('usuarios')
      .insert([{ auth_id, correo, rol }])
      .select()
      .single();

    if (insertErr) {
      console.error('Error insertando en usuarios:', insertErr);
      await supabaseAdmin.auth.admin.deleteUser(auth_id); // rollback
      return res.status(500).json({ error: insertErr.message });
    }

    let pacienteRow = null;

    // 4) Si es paciente, conectar o crear
if (rol === 'paciente') {
  if (pacienteExistente && !pacienteExistente.id_usuario) {
    // 🔑 Reclamar paciente existente
    const { data: updated, error: updErr } = await supabaseAdmin
      .from('pacientes')
      .update({ id_usuario: userRow.id_usuario })
      .eq('id_paciente', pacienteExistente.id_paciente)
      .select()
      .single();

    if (updErr) {
      console.error('Error actualizando paciente existente:', updErr);
      return res.status(500).json({ error: updErr.message });
    }

    // 👉 crear la relación en paciente_usuario
    const { error: relErr } = await supabaseAdmin
      .from('paciente_usuario')
      .insert([{
        id_paciente: updated.id_paciente,
        id_usuario: userRow.id_usuario,
        rol_relacion: 'titular',
        estado: true
      }]);

    if (relErr) {
      console.error('Error creando relación paciente_usuario:', relErr);
      return res.status(500).json({ error: relErr.message });
    }

    pacienteRow = updated;
  } else {
    // 🆕 Crear nuevo paciente
    const { data: pacData, error: pacErr } = await supabaseAdmin
      .from('pacientes')
      .insert([{
        id_usuario: userRow.id_usuario,
        numero_documento,
        tipo_documento,
        nombre,
        ape_pat,
        ape_mat,
        fecha_nacimiento: formatDate(fecha_nacimiento),
        telefono,
        sexo
      }])
      .select()
      .single();

    if (pacErr) {
      console.error('Error insertando en pacientes:', pacErr);
      // rollback
      await supabaseAdmin.from('usuarios').delete().eq('id_usuario', userRow.id_usuario);
      await supabaseAdmin.auth.admin.deleteUser(auth_id);
      return res.status(500).json({ error: pacErr.message });
    }

    // 👉 crear la relación en paciente_usuario
    const { error: relErr } = await supabaseAdmin
      .from('paciente_usuario')
      .insert([{
        id_paciente: pacData.id_paciente,
        id_usuario: userRow.id_usuario,
        rol_relacion: 'titular',
        estado: true
      }]);

    if (relErr) {
      console.error('Error creando relación paciente_usuario:', relErr);
      return res.status(500).json({ error: relErr.message });
    }

    pacienteRow = pacData;
  }
}


    // 5) Responder
    return res.json(buildResponse(
      { ...userRow, id: auth_id }, 
      null, 
      pacienteRow
    ));
  } catch (err) {
    console.error('register error', err);
    return res.status(500).json({ error: 'Error interno en register' });
  }
}

export async function login(req, res) {
  try {
    const { numero_documento, password } = req.body;
    if (!numero_documento || !password) 
      return res.status(400).json({ error: 'Faltan campos: numero_documento, password' });

    // 1) Buscar paciente por numero_documento (consulta simple)
    const { data: paciente, error: pErr } = await supabaseAdmin
      .from('pacientes')
      .select(`
        id_paciente,
        id_usuario,
        numero_documento,
        tipo_documento,
        nombre,
        ape_pat,
        ape_mat,
        fecha_nacimiento,
        telefono,
        sexo
      `)
      .eq('numero_documento', numero_documento)
      .limit(1)
      .maybeSingle();

    if (pErr) {
      console.error('Error buscando paciente:', pErr);
      return res.status(500).json({ error: 'Error buscando paciente' });
    }

    if (!paciente) {
      // No existe paciente con ese número
      return res.status(401).json({ error: 'Número de documento o contraseña inválidos' });
    }

    // 2) Obtener el correo del usuario asociado (si existe id_usuario)
    let usuarioRow = null;
    if (paciente.id_usuario) {
      const { data: uData, error: uErr } = await supabaseAdmin
        .from('usuarios')
        .select('id_usuario, auth_id, correo, rol, creado_en')
        .eq('id_usuario', paciente.id_usuario)
        .maybeSingle();

      if (uErr) {
        console.error('Error obteniendo usuario asociado:', uErr);
        return res.status(500).json({ error: 'Error buscando usuario' });
      }
      usuarioRow = uData;
    } else {
      // caso raro: paciente existe pero no tiene id_usuario
      // opcional: buscar en paciente_usuario por titular/autorizado
      const { data: rel, error: relErr } = await supabaseAdmin
        .from('paciente_usuario')
        .select('id_usuario, rol_relacion, estado, usuarios ( id_usuario, auth_id, correo, rol )')
        .eq('id_paciente', paciente.id_paciente)
        .eq('estado', true)
        .limit(1)
        .maybeSingle();

      if (relErr) {
        console.error('Error buscando relacion paciente_usuario:', relErr);
        return res.status(500).json({ error: 'Error buscando usuario' });
      }
      if (rel && rel.usuarios) usuarioRow = rel.usuarios;
    }

    if (!usuarioRow || !usuarioRow.correo) {
      console.error('Paciente sin usuario asociado (id_paciente):', paciente.id_paciente);
      return res.status(400).json({ error: 'No hay un usuario asociado a este paciente' });
    }

    // 3) Hacer login en Supabase Auth con el correo encontrado
    const { data: signInData, error: signInErr } = await supabaseAnon.auth.signInWithPassword({
      email: usuarioRow.correo,
      password
    });

    if (signInErr) {
      console.error('Error en signInWithPassword:', signInErr);
      return res.status(401).json({ error: 'Número de documento o contraseña inválidos' });
    }

    // 4) Construir la respuesta unificada
    // obtener usuario completo (para devolver rol, creado_en, id_usuario, etc.)
    const usuarioParaRespuesta = {
      id_usuario: usuarioRow.id_usuario,
      correo: usuarioRow.correo,
      rol: usuarioRow.rol,
      creado_en: usuarioRow.creado_en
    };

    return res.json(buildResponse(
      { ...usuarioParaRespuesta, id: signInData.user.id, email: signInData.user.email },
      signInData.session,
      paciente
    ));
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
      .select(`
        id_usuario,
        correo,
        rol,
        creado_en,
        pacientes (
          id_paciente,
          numero_documento,
          tipo_documento,
          nombre,
          ape_pat,
          ape_mat,
          fecha_nacimiento,
          telefono,
          sexo
        )
      `)
      .eq('auth_id', authUser.id)
      .maybeSingle();

    if (profErr) {
      return res.status(500).json({ error: 'Error consultando perfil' });
    }

    return res.json(buildResponse(
      { ...profile, id: authUser.id, email: authUser.email }, 
      null, 
      profile.rol === 'paciente' ? profile.pacientes : null
    ));
  } catch (err) {
    console.error('me error', err);
    return res.status(500).json({ error: 'Error interno en me' });
  }
}
