// src/controllers/pacientesController.js
import { supabaseAdmin } from '../supabaseClient.js';

/**
 * Crear paciente (ej. hijo) y asociarlo al usuario logueado.
 */
export async function crearPaciente(req, res) {
  try {
    const authUser = req.user;
    if (!authUser?.id) return res.status(401).json({ error: 'Usuario no autenticado' });
    const auth_id = authUser.id;

    const { data: usuarioRow, error: usuarioErr } = await supabaseAdmin
      .from('usuarios')
      .select('id_usuario')
      .eq('auth_id', auth_id)
      .maybeSingle();

    if (usuarioErr) throw usuarioErr;
    if (!usuarioRow) return res.status(400).json({ error: 'No se encontró registro en tabla usuarios para este auth_id' });

    const id_usuario = usuarioRow.id_usuario;

    const {
      numero_documento,
      tipo_documento = 'DNI',
      nombre,
      ape_pat,
      ape_mat,
      fecha_nacimiento,
      telefono,
      direccion,
      sexo,
      rol_relacion = 'titular'
    } = req.body;

    if (!numero_documento || !nombre || !ape_pat)
      return res.status(400).json({ error: 'Faltan campos obligatorios' });

    const { data: pacienteExistente, error: existeErr } = await supabaseAdmin
      .from('pacientes')
      .select('*')
      .eq('numero_documento', numero_documento)
      .eq('tipo_documento', tipo_documento)
      .maybeSingle();

    if (existeErr) throw existeErr;

    let pacienteRow;

    if (pacienteExistente) {
      pacienteRow = pacienteExistente;

      const { data: relacion, error: relErr } = await supabaseAdmin
        .from('paciente_usuario')
        .select('id')
        .eq('id_paciente', pacienteRow.id_paciente)
        .eq('id_usuario', id_usuario)
        .maybeSingle();

      if (relErr) throw relErr;

      if (!relacion) {
        const { error: insertRelErr } = await supabaseAdmin
          .from('paciente_usuario')
          .insert([{ id_paciente: pacienteRow.id_paciente, id_usuario, rol_relacion, estado: true }]);
        if (insertRelErr) throw insertRelErr;
      }

      return res.json({ ok: true, paciente: pacienteRow, message: 'Paciente existente vinculado' });
    }

    const { data: nuevoPaciente, error: insertPacErr } = await supabaseAdmin
      .from('pacientes')
      .insert([{
        numero_documento,
        tipo_documento,
        nombre,
        ape_pat,
        ape_mat: ape_mat || null,
        fecha_nacimiento: fecha_nacimiento || null,
        telefono: telefono || null,
        direccion: direccion || null,
        sexo: sexo || null
      }])
      .select()
      .single();

    if (insertPacErr) throw insertPacErr;

    pacienteRow = nuevoPaciente;

    const { error: relErr } = await supabaseAdmin
      .from('paciente_usuario')
      .insert([{ id_paciente: pacienteRow.id_paciente, id_usuario, rol_relacion, estado: true }]);

    if (relErr) throw relErr;

    return res.status(201).json({ ok: true, paciente: pacienteRow });

  } catch (err) {
    console.error('crearPaciente error', err);
    return res.status(500).json({ error: 'Error al crear paciente', detail: err.message });
  }
}



/**
 * Obtener pacientes asociados al usuario autenticado
 */
export async function obtenerPacientesUsuario(req, res) {
  try {
    const authUser = req.user;
    if (!authUser?.id) return res.status(401).json({ error: 'Usuario no autenticado' });
    const auth_id = authUser.id;

    const { data: usuarioRow } = await supabaseAdmin
      .from('usuarios')
      .select('id_usuario')
      .eq('auth_id', auth_id)
      .maybeSingle();

    if (!usuarioRow) return res.status(400).json({ error: 'Usuario no encontrado' });

    const id_usuario = usuarioRow.id_usuario;

    const { data, error } = await supabaseAdmin
      .from('paciente_usuario')
      .select(`
        id,
        rol_relacion,
        estado,
        pacientes (
          id_paciente,
          numero_documento,
          tipo_documento,
          nombre,
          ape_pat,
          ape_mat,
          fecha_nacimiento,
          telefono,
          direccion,
          sexo
        )
      `)
      .eq('id_usuario', id_usuario)
      .eq('estado', true);

    if (error) throw error;

    const pacientes = data.map(row => ({
      id_paciente: row.pacientes.id_paciente,
      numero_documento: row.pacientes.numero_documento,
      tipo_documento: row.pacientes.tipo_documento,
      nombre: row.pacientes.nombre,
      ape_pat: row.pacientes.ape_pat,
      ape_mat: row.pacientes.ape_mat,
      fecha_nacimiento: row.pacientes.fecha_nacimiento,
      telefono: row.pacientes.telefono,
      direccion: row.pacientes.direccion,
      sexo: row.pacientes.sexo,
      rol_relacion: row.rol_relacion
    }));

    return res.json({ ok: true, pacientes });

  } catch (err) {
    console.error('obtenerPacientesUsuario error', err);
    return res.status(500).json({ error: 'Error al obtener pacientes', detail: err.message });
  }
}



/**
 * Reclamar paciente existente
 */
export async function claimPaciente(req, res) {
  try {
    const { id_paciente } = req.params;
    const { rol_relacion = 'titular' } = req.body;
    const authUser = req.user;

    if (!authUser?.id) return res.status(401).json({ error: 'Usuario no autenticado' });

    const { data: usuarioRow } = await supabaseAdmin
      .from('usuarios')
      .select('id_usuario')
      .eq('auth_id', authUser.id)
      .maybeSingle();

    if (!usuarioRow) return res.status(400).json({ error: 'Usuario no encontrado' });

    const id_usuario = usuarioRow.id_usuario;

    const { data: relacion } = await supabaseAdmin
      .from('paciente_usuario')
      .select('*')
      .eq('id_paciente', id_paciente)
      .eq('id_usuario', id_usuario)
      .maybeSingle();

    if (relacion) {
      return res.status(400).json({ error: 'Ya estás vinculado a este paciente' });
    }

    if (rol_relacion === 'titular') {
      const { data: titularExistente } = await supabaseAdmin
        .from('paciente_usuario')
        .select('id_usuario')
        .eq('id_paciente', id_paciente)
        .eq('rol_relacion', 'titular')
        .eq('estado', true)
        .maybeSingle();

      if (titularExistente) {
        return res.status(400).json({ error: 'Este paciente ya tiene titular' });
      }
    }

    const { data, error } = await supabaseAdmin
      .from('paciente_usuario')
      .insert([{ id_paciente, id_usuario, rol_relacion, estado: true }])
      .select()
      .single();

    if (error) throw error;

    return res.json({ ok: true, relacion: data });

  } catch (err) {
    console.error('claimPaciente error', err);
    return res.status(500).json({ error: 'Error al vincular paciente', detail: err.message });
  }
}



/**
 * Obtener todos los pacientes del usuario (alias)
 */
export async function obtenerPacientesDeUsuario(req, res) {
  try {
    const { id_usuario } = req.user;
    if (!id_usuario) return res.status(400).json({ error: 'No se pudo identificar al usuario' });

    const { data, error } = await supabaseAdmin
      .from('paciente_usuario')
      .select(`
        id,
        rol_relacion,
        estado,
        pacientes (*)
      `)
      .eq('id_usuario', id_usuario)
      .eq('estado', true);

    if (error) throw error;

    return res.json({ ok: true, pacientes: data });

  } catch (err) {
    console.error('obtenerPacientesDeUsuario error', err);
    return res.status(500).json({ error: 'Error', detail: err.message });
  }
}



/**
 * Actualizar datos de un paciente
 */
export async function actualizarPaciente(req, res) {
  try {
    const { id_paciente } = req.params;
    const authUser = req.user;

    if (!authUser?.id)
      return res.status(401).json({ error: 'Usuario no autenticado' });

    const { data: usuarioRow } = await supabaseAdmin
      .from('usuarios')
      .select('id_usuario')
      .eq('auth_id', authUser.id)
      .maybeSingle();

    if (!usuarioRow)
      return res.status(400).json({ error: 'Usuario no encontrado' });

    const id_usuario = usuarioRow.id_usuario;

    const { data: relacion } = await supabaseAdmin
      .from('paciente_usuario')
      .select('id')
      .eq('id_usuario', id_usuario)
      .eq('id_paciente', id_paciente)
      .eq('estado', true)
      .maybeSingle();

    if (!relacion)
      return res.status(403).json({ error: 'No tienes acceso a este paciente' });

    const {
      nombre,
      ape_pat,
      ape_mat,
      fecha_nacimiento,
      telefono,
      direccion,
      sexo
    } = req.body;

    const campos = {
      ...(nombre && { nombre }),
      ...(ape_pat && { ape_pat }),
      ...(ape_mat && { ape_mat }),
      ...(fecha_nacimiento && { fecha_nacimiento }),
      ...(telefono && { telefono }),
      ...(direccion && { direccion }),
      ...(sexo && { sexo })
    };

    const { data, error } = await supabaseAdmin
      .from('pacientes')
      .update(campos)
      .eq('id_paciente', id_paciente)
      .select()
      .single();

    if (error) throw error;

    return res.json({ ok: true, paciente: data });

  } catch (err) {
    console.error('actualizarPaciente error', err);
    return res.status(500).json({ error: 'Error al actualizar', detail: err.message });
  }
}



/**
 * Desvincular paciente del usuario
 */
export async function desvincularPaciente(req, res) {
  try {
    const { id_paciente } = req.params;
    const authUser = req.user;

    const { data: usuarioRow } = await supabaseAdmin
      .from('usuarios')
      .select('id_usuario')
      .eq('auth_id', authUser.id)
      .maybeSingle();

    if (!usuarioRow) return res.status(400).json({ error: 'Usuario no encontrado' });

    const id_usuario = usuarioRow.id_usuario;

    const { data: relacion } = await supabaseAdmin
      .from('paciente_usuario')
      .select('id')
      .eq('id_paciente', id_paciente)
      .eq('id_usuario', id_usuario)
      .eq('estado', true)
      .maybeSingle();

    if (!relacion)
      return res.status(404).json({ error: 'No existe relación' });

    const { error } = await supabaseAdmin
      .from('paciente_usuario')
      .update({ estado: false })
      .eq('id_paciente', id_paciente)
      .eq('id_usuario', id_usuario);

    if (error) throw error;

    return res.json({ ok: true, message: 'Paciente desvinculado' });

  } catch (err) {
    console.error('desvincularPaciente error', err);
    return res.status(500).json({ error: 'Error', detail: err.message });
  }
}



/**
 * Obtener datos completos de un paciente por ID
 */
export async function obtenerPacientePorId(req, res) {
  try {
    const { id_paciente } = req.params;
    const authUser = req.user;

    const { data: usuarioRow } = await supabaseAdmin
      .from('usuarios')
      .select('id_usuario')
      .eq('auth_id', authUser.id)
      .maybeSingle();

    if (!usuarioRow)
      return res.status(400).json({ error: 'Usuario no encontrado' });

    const id_usuario = usuarioRow.id_usuario;

    const { data: relacion } = await supabaseAdmin
      .from('paciente_usuario')
      .select('rol_relacion, estado')
      .eq('id_usuario', id_usuario)
      .eq('id_paciente', id_paciente)
      .eq('estado', true)
      .maybeSingle();

    if (!relacion)
      return res.status(403).json({ error: 'No tienes acceso' });

    // 🔹 Obtener datos básicos del paciente
    const { data: paciente } = await supabaseAdmin
      .from('pacientes')
      .select('*')
      .eq('id_paciente', id_paciente)
      .maybeSingle();

    if (!paciente)
      return res.status(404).json({ error: 'Paciente no encontrado' });

    // 🔥 Obtener estadísticas de citas
    const { data: citasAsistidas } = await supabaseAdmin
      .from('citas')
      .select('id_cita', { count: 'exact' })
      .eq('id_paciente', id_paciente)
      .eq('estado', 'completada');

    const { data: citasPendientes } = await supabaseAdmin
      .from('citas')
      .select('id_cita', { count: 'exact' })
      .eq('id_paciente', id_paciente)
      .eq('estado', 'pendiente');

    const { data: citasCanceladas } = await supabaseAdmin
      .from('citas')
      .select('id_cita', { count: 'exact' })
      .eq('id_paciente', id_paciente)
      .eq('estado', 'cancelada');

    // 🔥 Obtener historial
    const { data: historial } = await supabaseAdmin
      .from('historial')
      .select(`
        *,
        cita:citas(fecha)
      `)
      .eq('id_paciente', id_paciente)
      .order('creado_en', { ascending: false });

    return res.json({
      ok: true,
      paciente,
      historial: historial || [],
      citas_asistidas: citasAsistidas?.length || 0,
      citas_pendientes: citasPendientes?.length || 0,
      citas_canceladas: citasCanceladas?.length || 0
    });

  } catch (err) {
    console.error('obtenerPacientePorId error', err);
    return res.status(500).json({ error: 'Error', detail: err.message });
  }
}




/**
 * Obtener perfil del paciente titular
 */
export async function obtenerPerfilTitular(req, res) {
  try {
    const authUser = req.user;
    if (!authUser?.id)
      return res.status(401).json({ error: 'Usuario no autenticado' });

    // Obtener id_usuario usando el auth_id del token
    const { data: usuarioRow, error: usuarioErr } = await supabaseAdmin
      .from('usuarios')
      .select('id_usuario')
      .eq('auth_id', authUser.id)
      .maybeSingle();

    if (usuarioErr) throw usuarioErr;
    if (!usuarioRow)
      return res.status(400).json({ error: 'Usuario no encontrado' });

    const id_usuario = usuarioRow.id_usuario;

    // Buscar titular en la tabla pivote paciente_usuario
    const { data: relacion, error: relacionErr } = await supabaseAdmin
      .from('paciente_usuario')
      .select(`
        id_paciente,
        pacientes (
          id_paciente,
          numero_documento,
          tipo_documento,
          nombre,
          ape_pat,
          ape_mat,
          fecha_nacimiento,
          telefono,
          direccion,
          sexo
        )
      `)
      .eq('id_usuario', id_usuario)
      .eq('rol_relacion', 'titular')
      .eq('estado', true)
      .maybeSingle();

    if (relacionErr) throw relacionErr;

    if (!relacion)
      return res.status(404).json({ error: 'No tienes paciente titular' });

    return res.json({ ok: true, paciente: relacion.pacientes });

  } catch (err) {
    console.error('obtenerPerfilTitular error', err);
    return res.status(500).json({
      error: 'Error al obtener perfil',
      detail: err.message
    });
  }
}




/**
 * Actualizar perfil del paciente titular
 */
export async function actualizarPerfilTitular(req, res) {
  try {
    const authUser = req.user;

    if (!authUser?.id)
      return res.status(401).json({ error: 'Usuario no autenticado' });

    // Obtener id_usuario real del token
    let { id_usuario } = authUser;

    if (!id_usuario) {
      const { data: usuarioRow, error: usuarioErr } = await supabaseAdmin
        .from('usuarios')
        .select('id_usuario')
        .eq('auth_id', authUser.id)
        .maybeSingle();

      if (usuarioErr) throw usuarioErr;
      if (!usuarioRow)
        return res.status(400).json({ error: 'Usuario no encontrado' });

      id_usuario = usuarioRow.id_usuario;
    }

    // Obtener el id del paciente titular desde la tabla pivote
    const { data: relacion, error: relErr } = await supabaseAdmin
      .from('paciente_usuario')
      .select('id_paciente')
      .eq('id_usuario', id_usuario)
      .eq('rol_relacion', 'titular')
      .eq('estado', true)
      .maybeSingle();

    if (relErr) throw relErr;
    if (!relacion)
      return res.status(404).json({ error: 'No tienes paciente titular' });

    const id_paciente = relacion.id_paciente;

    // Campos que se pueden actualizar
    const {
      nombre,
      ape_pat,
      ape_mat,
      telefono,
      direccion,
      fecha_nacimiento,
      sexo
    } = req.body;

    const campos = {
      ...(nombre && { nombre }),
      ...(ape_pat && { ape_pat }),
      ...(ape_mat && { ape_mat }),
      ...(telefono && { telefono }),
      ...(direccion && { direccion }),
      ...(fecha_nacimiento && { fecha_nacimiento }),
      ...(sexo && { sexo })
    };

    if (Object.keys(campos).length === 0)
      return res.status(400).json({ error: 'No se enviaron campos' });

    // Actualizar paciente
    const { data: pacienteActualizado, error: updateErr } = await supabaseAdmin
      .from('pacientes')
      .update(campos)
      .eq('id_paciente', id_paciente)
      .select()
      .single();

    if (updateErr) throw updateErr;

    return res.json({
      ok: true,
      paciente: pacienteActualizado,
      message: 'Perfil actualizado correctamente'
    });

  } catch (err) {
    console.error('actualizarPerfilTitular error', err);
    return res.status(500).json({
      error: 'Error al actualizar perfil',
      detail: err.message
    });
  }
}

/**
 * Cambiar correo del usuario autenticado
 */
export async function cambiarCorreo(req, res) {
  try {
    const authUser = req.user;

    if (!authUser?.id)
      return res.status(401).json({ error: 'Usuario no autenticado' });

    const { correo } = req.body;
    if (!correo)
      return res.status(400).json({ error: 'El correo es obligatorio' });

    // 1️⃣ Obtener id_usuario desde auth_id
    const { data: usuarioRow, error: usuarioErr } = await supabaseAdmin
      .from('usuarios')
      .select('id_usuario')
      .eq('auth_id', authUser.id)
      .maybeSingle();

    if (usuarioErr) throw usuarioErr;
    if (!usuarioRow)
      return res.status(400).json({ error: 'Usuario no encontrado' });

    // 2️⃣ Actualizar correo en tabla usuarios
    const { error: updateBD } = await supabaseAdmin
      .from('usuarios')
      .update({ correo })
      .eq('auth_id', authUser.id);

    if (updateBD) throw updateBD;

    // 3️⃣ Actualizar correo en Supabase Auth
    const { error: updateAuth } = await supabaseAdmin.auth.admin.updateUserById(
      authUser.id,
      { email: correo }
    );

    if (updateAuth) throw updateAuth;

    return res.json({ ok: true, message: 'Correo actualizado correctamente' });

  } catch (err) {
    console.error('cambiarCorreo error:', err);
    return res.status(500).json({ error: 'Error al cambiar correo', detail: err.message });
  }
}

/**
 * Cambiar contraseña del usuario autenticado
 */
export async function cambiarContrasena(req, res) {
  try {
    const authUser = req.user;

    if (!authUser?.email)
      return res.status(401).json({ error: 'Usuario no autenticado' });

    const { actual, nueva } = req.body;

    if (!actual || !nueva)
      return res.status(400).json({ error: 'Debe enviar contraseña actual y nueva' });

    // 1️⃣ Validar contraseña actual realizando login
    const { error: loginErr } = await supabaseAdmin.auth.signInWithPassword({
      email: authUser.email,
      password: actual
    });

    if (loginErr) {
      return res.status(400).json({ error: 'La contraseña actual es incorrecta' });
    }

    // 2️⃣ Actualizar contraseña en Supabase Auth
    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(
      authUser.id,
      { password: nueva }
    );

    if (updateErr) throw updateErr;

    return res.json({ ok: true, message: 'Contraseña actualizada correctamente' });

  } catch (err) {
    console.error('cambiarContrasena error:', err);
    return res.status(500).json({
      error: 'Error al cambiar contraseña',
      detail: err.message
    });
  }
}
