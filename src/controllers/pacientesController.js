// src/controllers/pacientesController.js
import { supabaseAdmin } from '../supabaseClient.js';

/**
 * Crear paciente (ej. hijo) y asociarlo al usuario logueado.
 * Usa las columnas que tienes: numero_documento, tipo_documento, nombre, ape_pat, ape_mat, fecha_nacimiento, telefono, direccion, sexo
 */
export async function crearPaciente(req, res) {
  try {
    // req.user viene de authMiddleware -> es el user auth de supabase (contiene .id)
    const authUser = req.user;
    if (!authUser?.id) return res.status(401).json({ error: 'Usuario no autenticado' });
    const auth_id = authUser.id;

    // 1) Obtener id_usuario en tu tabla "usuarios" a partir del auth_id
    const { data: usuarioRow, error: usuarioErr } = await supabaseAdmin
      .from('usuarios')
      .select('id_usuario')
      .eq('auth_id', auth_id)
      .maybeSingle();

    if (usuarioErr) throw usuarioErr;
    if (!usuarioRow) return res.status(400).json({ error: 'No se encontró registro en tabla usuarios para este auth_id' });

    const id_usuario = usuarioRow.id_usuario;

    // 2) Campos recibidos desde el cliente
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
      rol_relacion = 'titular' // 'titular' | 'responsable' | 'autorizado'
    } = req.body;

    if (!numero_documento || !nombre || !ape_pat) {
      return res.status(400).json({ error: 'Faltan campos obligatorios: numero_documento, nombre, ape_pat' });
    }

    // 3) Buscar si ya existe paciente con ese documento (evitar duplicados)
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

      // 3.a) Si ya existe el paciente, comprobar/crear la relación paciente_usuario
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
          .insert([{
            id_paciente: pacienteRow.id_paciente,
            id_usuario,
            rol_relacion,
            estado: true
          }]);
        if (insertRelErr) throw insertRelErr;
      }

      return res.status(200).json({ ok: true, paciente: pacienteRow, message: 'Paciente existente vinculado al usuario' });
    }

    // 4) Si no existe, insertar nuevo paciente
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

    if (insertPacErr) {
      // si hay un error por unique constraint, manejarlo más adelante si quieres
      throw insertPacErr;
    }

    pacienteRow = nuevoPaciente;

    // 5) Crear relación paciente_usuario
    const { error: insertRelErr2 } = await supabaseAdmin
      .from('paciente_usuario')
      .insert([{
        id_paciente: pacienteRow.id_paciente,
        id_usuario,
        rol_relacion,
        estado: true
      }]);

    if (insertRelErr2) throw insertRelErr2;

    return res.status(201).json({ ok: true, paciente: pacienteRow });
  } catch (err) {
    console.error('crearPaciente error', err);
    // Si Supabase devuelve un error con code 23505 (unique violation), se puede mapear aquí
    return res.status(500).json({ error: 'Error al crear paciente', detail: err.message || err });
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

    // Obtener id_usuario
    const { data: usuarioRow, error: usuarioErr } = await supabaseAdmin
      .from('usuarios')
      .select('id_usuario')
      .eq('auth_id', auth_id)
      .maybeSingle();

    if (usuarioErr) throw usuarioErr;
    if (!usuarioRow) return res.status(400).json({ error: 'No se encontró registro en tabla usuarios para este auth_id' });

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
          sexo,
          creado_en
        )
      `)
      .eq('id_usuario', id_usuario)
      .eq('estado', true);

    if (error) throw error;

    // Mapear para devolver sólo el array de pacientes con la info útil (opcional)
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
      rol_relacion: row.rol_relacion,
      relacion_estado: row.estado
    }));

    return res.json({ ok: true, pacientes });
  } catch (err) {
    console.error('obtenerPacientesUsuario error', err);
    return res.status(500).json({ error: 'Error al obtener pacientes', detail: err.message || err });
  }
}

// Vincular usuario con un paciente existente (claim)
export async function claimPaciente(req, res) {
  try {
    const { id_paciente } = req.params;
    const { rol_relacion = 'titular' } = req.body;

    // 1) Obtener authUser
    const authUser = req.user;
    if (!authUser?.id) return res.status(401).json({ error: 'Usuario no autenticado' });
    const auth_id = authUser.id;

    // 2) Buscar el id_usuario en tabla usuarios
    const { data: usuarioRow, error: usuarioErr } = await supabaseAdmin
      .from('usuarios')
      .select('id_usuario')
      .eq('auth_id', auth_id)
      .maybeSingle();

    if (usuarioErr) throw usuarioErr;
    if (!usuarioRow) return res.status(400).json({ error: 'No se encontró usuario para este auth_id' });

    const id_usuario = usuarioRow.id_usuario;

    if (!id_paciente) {
      return res.status(400).json({ error: 'Falta id_paciente' });
    }

    // 3) Verificar si ya existe relación de este usuario con el paciente
    const { data: relacionExistente, error: errorCheck } = await supabaseAdmin
      .from('paciente_usuario')
      .select('*')
      .eq('id_paciente', id_paciente)
      .eq('id_usuario', id_usuario)
      .maybeSingle();

    if (errorCheck) throw errorCheck;
    if (relacionExistente) {
      return res.status(400).json({ error: 'El usuario ya está vinculado a este paciente' });
    }

    // 4) Si quiere ser titular, validar que no exista ya un titular
    if (rol_relacion === 'titular') {
      const { data: titularExistente, error: titularErr } = await supabaseAdmin
        .from('paciente_usuario')
        .select('id_usuario')
        .eq('id_paciente', id_paciente)
        .eq('rol_relacion', 'titular')
        .eq('estado', true)
        .maybeSingle();

      if (titularErr) throw titularErr;
      if (titularExistente) {
        return res.status(400).json({ error: 'Este paciente ya tiene un titular asignado' });
      }
    }

    // 5) Crear la relación
    const { data, error } = await supabaseAdmin
      .from('paciente_usuario')
      .insert([{
        id_paciente,
        id_usuario,
        rol_relacion,
        estado: true
      }])
      .select()
      .single();

    if (error) throw error;

    res.json({ ok: true, relacion: data });
  } catch (err) {
    console.error('claimPaciente error', err);
    res.status(500).json({ error: 'Error al vincular paciente', detail: err.message || err });
  }
}


// Obtener todos los pacientes relacionados a un usuario
export async function obtenerPacientesDeUsuario(req, res) {
  try {
    const { id_usuario } = req.user; // viene del authMiddleware

    if (!id_usuario) {
      return res.status(400).json({ error: 'No se pudo identificar al usuario' });
    }

    const { data, error } = await supabaseAdmin
      .from('paciente_usuario')
      .select(`
        id,
        rol_relacion,
        estado,
        pacientes (
          id_paciente,
          tipo_documento,
          numero_documento,
          nombre,
          ape_pat,
          ape_mat,
          fecha_nacimiento,
          telefono,
          direccion,
          sexo,
          creado_en
        )
      `)
      .eq('id_usuario', id_usuario)
      .eq('estado', true);

    if (error) throw error;

    res.json({ ok: true, pacientes: data });
  } catch (err) {
    console.error('obtenerPacientesDeUsuario error', err);
    res.status(500).json({ error: 'Error al obtener pacientes del usuario' });
  }
}


export async function actualizarPaciente(req, res) {
  try {
    const { id_paciente } = req.params;
    const authUser = req.user;

    if (!authUser?.id)
      return res.status(401).json({ error: "Usuario no autenticado" });

    // Obtener id_usuario interno
    const { data: usuarioRow } = await supabaseAdmin
      .from("usuarios")
      .select("id_usuario")
      .eq("auth_id", authUser.id)
      .maybeSingle();

    if (!usuarioRow)
      return res.status(400).json({ error: "Usuario no encontrado" });

    const id_usuario = usuarioRow.id_usuario;

    // Verificar que el usuario esté asociado a este paciente
    const { data: relacion } = await supabaseAdmin
      .from("paciente_usuario")
      .select("id")
      .eq("id_usuario", id_usuario)
      .eq("id_paciente", id_paciente)
      .eq("estado", true)
      .maybeSingle();

    if (!relacion)
      return res.status(403).json({ error: "No tienes acceso a este paciente" });

    // Campos permitidos
    const {
      nombre,
      ape_pat,
      ape_mat,
      fecha_nacimiento,
      telefono,
      direccion,
      sexo,
    } = req.body;

    const campos = {
      ...(nombre && { nombre }),
      ...(ape_pat && { ape_pat }),
      ...(ape_mat && { ape_mat }),
      ...(fecha_nacimiento && { fecha_nacimiento }),
      ...(telefono && { telefono }),
      ...(direccion && { direccion }),
      ...(sexo && { sexo }),
    };

    // Actualizar datos
    const { data, error } = await supabaseAdmin
      .from("pacientes")
      .update(campos)
      .eq("id_paciente", id_paciente)
      .select()
      .single();

    if (error) throw error;

    res.json({ ok: true, paciente: data });
  } catch (err) {
    console.error("Error en actualizarPaciente:", err);
    res.status(500).json({
      error: "Error al actualizar paciente",
      detail: err.message,
    });
  }
}




export async function desvincularPaciente(req, res) {
  try {
    const { id_paciente } = req.params;
    const authUser = req.user;
    if (!authUser?.id) return res.status(401).json({ error: 'Usuario no autenticado' });

    // Obtener id_usuario
    const { data: usuarioRow } = await supabaseAdmin
      .from('usuarios')
      .select('id_usuario')
      .eq('auth_id', authUser.id)
      .maybeSingle();

    if (!usuarioRow) return res.status(400).json({ error: 'Usuario no encontrado' });
    const id_usuario = usuarioRow.id_usuario;

    // Verificar que exista relación activa
    const { data: relacion } = await supabaseAdmin
      .from('paciente_usuario')
      .select('id, rol_relacion')
      .eq('id_paciente', id_paciente)
      .eq('id_usuario', id_usuario)
      .eq('estado', true)
      .maybeSingle();

    if (!relacion) return res.status(404).json({ error: 'No existe relación con este paciente' });

    // Si es titular, podrías opcionalmente marcar inactivo a todas sus relaciones
    const { error } = await supabaseAdmin
      .from('paciente_usuario')
      .update({ estado: false })
      .eq('id_paciente', id_paciente)
      .eq('id_usuario', id_usuario);

    if (error) throw error;

    res.json({ ok: true, message: 'Paciente desvinculado correctamente' });
  } catch (err) {
    console.error('eliminarPaciente error', err);
    res.status(500).json({ error: 'Error al desvincular paciente', detail: err.message });
  }
}


export async function obtenerPacientePorId(req, res) {
  try {
    const { id_paciente } = req.params;
    const authUser = req.user;

    if (!authUser?.id) {
      return res.status(401).json({ error: "Usuario no autenticado" });
    }

    // 1) Buscar id_usuario interno
    const { data: usuarioRow, error: usuarioErr } = await supabaseAdmin
      .from("usuarios")
      .select("id_usuario")
      .eq("auth_id", authUser.id)
      .maybeSingle();

    if (usuarioErr) throw usuarioErr;
    if (!usuarioRow)
      return res.status(400).json({ error: "Usuario no encontrado" });

    const id_usuario = usuarioRow.id_usuario;

    // 2) Verificar relación usuario-paciente
    const { data: relacion, error: relErr } = await supabaseAdmin
      .from("paciente_usuario")
      .select("rol_relacion, estado")
      .eq("id_usuario", id_usuario)
      .eq("id_paciente", id_paciente)
      .eq("estado", true)
      .maybeSingle();

    if (relErr) throw relErr;

    if (!relacion) {
      return res
        .status(403)
        .json({ error: "No tienes acceso a este paciente" });
    }

    // 3) Obtener datos del paciente
    const { data: paciente, error: pacErr } = await supabaseAdmin
      .from("pacientes")
      .select("*")
      .eq("id_paciente", id_paciente)
      .maybeSingle();

    if (pacErr) throw pacErr;
    if (!paciente)
      return res.status(404).json({ error: "Paciente no encontrado" });

    // 4) Contadores de citas
    const { count: asistidas } = await supabaseAdmin
      .from("citas")
      .select("*", { count: "exact", head: true })
      .eq("id_paciente", id_paciente)
      .eq("estado", "completada");

    const { count: pendientes } = await supabaseAdmin
      .from("citas")
      .select("*", { count: "exact", head: true })
      .eq("id_paciente", id_paciente)
      .eq("estado", "pendiente");

    const { count: canceladas } = await supabaseAdmin
      .from("citas")
      .select("*", { count: "exact", head: true })
      .eq("id_paciente", id_paciente)
      .eq("estado", "cancelada");

    // 5) Historial clínico
    const { data: historialRaw, error: histErr } = await supabaseAdmin
      .from("historial")
      .select(
        `
        id_historial,
        diagnostico,
        observaciones,
        creado_en,
        citas (
          id_cita,
          fecha,
          hora_inicio,
          hora_fin,
          odontologos (
            id_odontologo,
            nombre,
            especialidad
          ),
          tratamiento_paciente (
            tratamientos (
              id_tratamiento,
              nombre
            )
          )
        )
      `
      )
      .eq("id_paciente", id_paciente)
      .order("creado_en", { ascending: false });

    if (histErr) throw histErr;

    const historial = (historialRaw ?? []).map((h) => ({
      id_historial: h.id_historial,
      diagnostico: h.diagnostico,
      observaciones: h.observaciones,
      creado_en: h.creado_en,
      cita: h.citas
        ? {
            id_cita: h.citas.id_cita,
            fecha: h.citas.fecha,
            hora_inicio: h.citas.hora_inicio,
            hora_fin: h.citas.hora_fin,
            odontologo: h.citas.odontologos,
            tratamiento:
              h.citas.tratamiento_paciente?.tratamientos ?? null,
          }
        : null,
    }));

    // 6) Permisos
    const es_titular = relacion.rol_relacion === "titular";

    return res.json({
      ok: true,
      paciente,
      rol_relacion: relacion.rol_relacion,
      es_titular,
      permisos: {
        puede_editar: es_titular,
        puede_desvincular: !es_titular,
      },
      citas_asistidas: asistidas ?? 0,
      citas_pendientes: pendientes ?? 0,
      citas_canceladas: canceladas ?? 0,
      historial,
    });
  } catch (err) {
    console.error("Error en obtenerPacientePorId:", err);
    res.status(500).json({
      error: "Error al obtener paciente",
      detail: err.message,
    });
  }
}










