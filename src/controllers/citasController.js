// src/controllers/citasController.js
import { supabaseAdmin } from '../supabaseClient.js';

/* ========================================================
   🧩 FUNCIONES AUXILIARES
   ======================================================== */
function calcularHoraFin(horaInicio, duracionMin = 40) {
  const horaFin = new Date(`1970-01-01T${horaInicio}`);
  horaFin.setMinutes(horaFin.getMinutes() + duracionMin);
  return horaFin.toISOString().substring(11, 19);
}

function haySolapamientoHorario(citas, horaInicio, horaFin) {
  return citas.some(cita => {
    const inicioExistente = new Date(`1970-01-01T${cita.hora_inicio}`);
    const finExistente = new Date(`1970-01-01T${cita.hora_fin}`);
    const inicioNueva = new Date(`1970-01-01T${horaInicio}`);
    const finNueva = new Date(`1970-01-01T${horaFin}`);
    return inicioExistente < finNueva && finExistente > inicioNueva;
  });
}

/* ========================================================
   🆕 CREAR CITA
   ======================================================== */
export async function crearCita(req, res) {
  try {
    console.log('📩 Datos recibidos para crear cita:', req.body);
    const { id_paciente, id_odontologo, fecha, hora_inicio, tipo_cita } = req.body;

    if (!id_paciente || !id_odontologo || !fecha || !hora_inicio) {
      return res.status(400).json({ ok: false, error: 'Faltan datos obligatorios' });
    }

    const ahora = new Date();
    const fechaHoraSeleccionada = new Date(`${fecha}T${hora_inicio}`);
    const diffMin = (fechaHoraSeleccionada - ahora) / (1000 * 60);

    if (diffMin < 60) {
      return res.status(400).json({
        ok: false,
        error: 'No puedes reservar citas con menos de 1 hora de anticipación o en horas pasadas'
      });
    }

    const hora_fin = calcularHoraFin(hora_inicio);

    // 🔹 Verificar si el paciente ya tiene cita ese día
    const { data: citasPaciente, error: errorPaciente } = await supabaseAdmin
      .from('citas')
      .select('id_cita')
      .eq('id_paciente', id_paciente)
      .eq('fecha', fecha)
      .in('estado', ['pendiente', 'confirmada']);

    if (errorPaciente) throw errorPaciente;
    if (citasPaciente?.length > 0) {
      return res.status(409).json({
        ok: false,
        error: 'El paciente ya tiene una cita registrada para este día'
      });
    }

    // 🔹 Validar solapamiento del odontólogo
    const { data: citasExistentes, error: errorSolapamiento } = await supabaseAdmin
      .from('citas')
      .select('hora_inicio, hora_fin')
      .eq('id_odontologo', id_odontologo)
      .eq('fecha', fecha)
      .in('estado', ['pendiente', 'confirmada']);

    if (errorSolapamiento) throw errorSolapamiento;

    if (haySolapamientoHorario(citasExistentes, hora_inicio, hora_fin)) {
      return res.status(409).json({
        ok: false,
        error: 'El odontólogo ya tiene una cita en ese horario'
      });
    }

    // 🆕 Crear cita
    const { data: nuevaCita, error: errorInsert } = await supabaseAdmin
      .from('citas')
      .insert([{
        id_paciente,
        id_odontologo,
        fecha,
        hora_inicio,
        hora_fin,
        tipo_cita: tipo_cita || 'consulta',
        estado: 'pendiente'
      }])
      .select('*')
      .single();

    if (errorInsert) throw errorInsert;

    // 🧠 Obtener datos de paciente y odontólogo
    const [{ data: paciente }, { data: odontologo }] = await Promise.all([
      supabaseAdmin.from('pacientes').select('id_paciente, nombre, apellido').eq('id_paciente', id_paciente).single(),
      supabaseAdmin.from('odontologos').select('id_odontologo, nombre, especialidad,sexo').eq('id_odontologo', id_odontologo).single()
    ]);

    res.status(201).json({
      ok: true,
      mensaje: 'Cita creada exitosamente',
      cita: {
        ...nuevaCita,
        paciente: {
          id_paciente,
          nombre_completo: `${paciente?.nombre || ''} ${paciente?.apellido || ''}`.trim()
        },
        odontologo: odontologo || null
      }
    });
  } catch (err) {
    console.error('crearCita error', err);
    res.status(500).json({ ok: false, error: 'Error interno al crear la cita' });
  }
}

/* ========================================================
   🔍 OBTENER CITAS POR PACIENTE
   ======================================================== */
export async function obtenerCitasPorPaciente(req, res) {
  try {
    const { id_paciente } = req.params;
    if (!id_paciente)
      return res.status(400).json({ ok: false, error: 'Se requiere id_paciente' });

    const { data, error } = await supabaseAdmin
      .from('citas')
      .select(`
        id_cita, fecha, hora_inicio, hora_fin, tipo_cita, estado,
        odontologos (id_odontologo, nombre, especialidad, sexo),
        pacientes (id_paciente, nombre, ape_pat, ape_mat)
      `)
      .eq('id_paciente', id_paciente)
      .in('estado', ['pendiente', 'confirmada'])
      .order('fecha', { ascending: true })
      .order('hora_inicio', { ascending: true });

    if (error) throw error;

    const citas = (data || []).map(c => ({
      id_cita: c.id_cita,
      fecha: c.fecha,
      hora_inicio: c.hora_inicio,
      hora_fin: c.hora_fin,
      tipo_cita: c.tipo_cita,
      estado: c.estado,
      odontologo: c.odontologos
        ? {
            id_odontologo: c.odontologos.id_odontologo,
            nombre: c.odontologos.nombre,
            especialidad: c.odontologos.especialidad,
            sexo: c.odontologos.sexo
          }
        : null,
      paciente: c.pacientes
        ? {
            id_paciente: c.pacientes.id_paciente,
            nombre_completo: `${c.pacientes.nombre} ${c.pacientes.ape_pat} ${c.pacientes.ape_mat}`.trim()
          }
        : null
    }));

    res.json({
      ok: true,
      citas,
      mensaje: citas.length ? undefined : 'No tienes citas pendientes ni confirmadas'
    });
  } catch (err) {
    console.error('obtenerCitasPorPaciente error', err);
    res.status(500).json({ ok: false, error: 'Error al obtener citas' });
  }
}


/* ========================================================
   🔁 REPROGRAMAR CITA
   ======================================================== */
export async function reprogramarCita(req, res) {
  try {
    const { id_cita } = req.params;
    const { fecha_nueva, hora_nueva, motivo } = req.body;

    if (!fecha_nueva || !hora_nueva)
      return res.status(400).json({ ok: false, error: 'Faltan datos para reprogramar' });

    const ahora = new Date();
    const fechaHoraNueva = new Date(`${fecha_nueva}T${hora_nueva}`);
    const diffMin = (fechaHoraNueva - ahora) / (1000 * 60);
    if (diffMin < 60) {
      return res.status(400).json({
        ok: false,
        error: 'No puedes reprogramar a una hora pasada o con menos de 1 hora de anticipación'
      });
    }

    const { data: citaActual, error: errorCita } = await supabaseAdmin
      .from('citas')
      .select('*')
      .eq('id_cita', id_cita)
      .single();

    if (errorCita || !citaActual)
      return res.status(404).json({ ok: false, error: 'Cita no encontrada' });

    const hora_fin_nueva = calcularHoraFin(hora_nueva);

    // Validaciones duplicadas
    const { data: citasPaciente } = await supabaseAdmin
      .from('citas')
      .select('id_cita')
      .eq('id_paciente', citaActual.id_paciente)
      .eq('fecha', fecha_nueva)
      .in('estado', ['pendiente', 'confirmada'])
      .neq('id_cita', id_cita);

    if (citasPaciente?.length > 0)
      return res.status(409).json({ ok: false, error: 'El paciente ya tiene otra cita ese día' });

    const { data: citasExistentes } = await supabaseAdmin
      .from('citas')
      .select('hora_inicio, hora_fin')
      .eq('id_odontologo', citaActual.id_odontologo)
      .eq('fecha', fecha_nueva)
      .in('estado', ['pendiente', 'confirmada'])
      .neq('id_cita', id_cita);

    if (haySolapamientoHorario(citasExistentes, hora_nueva, hora_fin_nueva)) {
      return res.status(409).json({ ok: false, error: 'El odontólogo ya tiene otra cita en ese horario' });
    }

    await supabaseAdmin.from('cita_reprogramaciones').insert([{
      id_cita,
      fecha_anterior: citaActual.fecha,
      hora_anterior: citaActual.hora_inicio,
      fecha_nueva,
      hora_nueva,
      motivo: motivo || null
    }]);

    const { data: citaActualizada, error: errorUpdate } = await supabaseAdmin
      .from('citas')
      .update({
        fecha: fecha_nueva,
        hora_inicio: hora_nueva,
        hora_fin: hora_fin_nueva
      })
      .eq('id_cita', id_cita)
      .select(`
        id_cita, fecha, hora_inicio, hora_fin, tipo_cita, estado,
        pacientes (id_paciente, nombre, apellido),
        odontologos (id_odontologo, nombre, especialidad,sexo)
      `)
      .single();

    if (errorUpdate) throw errorUpdate;

    res.json({
      ok: true,
      mensaje: 'Cita reprogramada exitosamente',
      cita: {
        id_cita: citaActualizada.id_cita,
        fecha: citaActualizada.fecha,
        hora_inicio: citaActualizada.hora_inicio,
        hora_fin: citaActualizada.hora_fin,
        tipo_cita: citaActualizada.tipo_cita,
        estado: citaActualizada.estado,
        paciente: {
          id_paciente: citaActualizada.pacientes.id_paciente,
          nombre_completo: `${citaActualizada.pacientes.nombre} ${citaActualizada.pacientes.apellido}`
        },
        odontologo: citaActualizada.odontologos
      }
    });
  } catch (err) {
    console.error('reprogramarCita error', err);
    res.status(500).json({ ok: false, error: 'Error al reprogramar la cita' });
  }
}

/* ========================================================
   📅 FECHAS DISPONIBLES
   ======================================================== */
export async function obtenerFechasDisponibles(req, res) {
  try {
    const hoy = new Date();
    const fechas = Array.from({ length: 15 }, (_, i) => {
      const fecha = new Date(hoy);
      fecha.setDate(hoy.getDate() + i);
      return fecha.toISOString().split('T')[0];
    });

    res.json({ ok: true, fechas });
  } catch (err) {
    console.error('obtenerFechasDisponibles error', err);
    res.status(500).json({ ok: false, error: 'Error al generar fechas disponibles' });
  }
}

/* ========================================================
   🦷 LISTAR DOCTORES
   ======================================================== */
export async function obtenerDoctores(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('odontologos')
      .select('id_odontologo, nombre, especialidad, sexo');

    if (error) throw error;
    res.json({ ok: true, doctores: data });
  } catch (err) {
    console.error('obtenerDoctores error', err);
    res.status(500).json({ ok: false, error: 'Error al obtener odontólogos' });
  }
}

/* ========================================================
   ⏰ HORARIOS DISPONIBLES
   ======================================================== */
export async function obtenerHorariosPorOdontologo(req, res) {
  try {
    const id_odontologo = req.params.id;
    const { fecha } = req.query;

    if (!fecha)
      return res.status(400).json({ ok: false, error: 'Se requiere parámetro de fecha' });

    const ahora = new Date();
    const hoyISO = ahora.toISOString().split('T')[0];

    const slotsManana = ['07:00:00','08:00:00','09:00:00','10:00:00','11:00:00'];
    const slotsTarde  = ['14:00:00','15:00:00','16:00:00','17:00:00'];
    const candidateSlots = [...slotsManana, ...slotsTarde];

    const { data: citasExistentes, error } = await supabaseAdmin
      .from('citas')
      .select('hora_inicio, hora_fin, estado')
      .eq('id_odontologo', id_odontologo)
      .eq('fecha', fecha)
      .in('estado', ['pendiente', 'confirmada']);

    if (error) throw error;

    const available = candidateSlots.filter(slot => {
      const slotFin = calcularHoraFin(slot);
      if (fecha === hoyISO) {
        const diff = (new Date(`1970-01-01T${slot}`) - new Date(`1970-01-01T${ahora.toTimeString().split(' ')[0]}`)) / 60000;
        if (diff < 60) return false;
      }
      return !haySolapamientoHorario(citasExistentes, slot, slotFin);
    });

    res.json({ ok: true, horarios: available });
  } catch (err) {
    console.error('obtenerHorariosPorOdontologo error', err);
    res.status(500).json({ ok: false, error: 'Error al obtener horarios disponibles' });
  }
}

/* ========================================================
   🧾 OBTENER CITAS POR USUARIO (TODOS SUS PACIENTES)
   ======================================================== */
export async function obtenerCitasPorUsuario(req, res) {
  try {
    const { id_usuario } = req.params;
    if (!id_usuario)
      return res.status(400).json({ ok: false, error: 'Se requiere id_usuario' });

    // 1️⃣ Buscar los pacientes asociados al usuario
    const { data: pacientes, error: errorPacientes } = await supabaseAdmin
      .from('paciente_usuario')
      .select(`
        pacientes (id_paciente, nombre)
      `)
      .eq('id_usuario', id_usuario);

    if (errorPacientes) throw errorPacientes;

    // Extraer pacientes (Supabase anida los datos)
    const listaPacientes = pacientes.map(p => p.pacientes);

    if (!listaPacientes || listaPacientes.length === 0) {
      return res.json({ ok: true, citas: [], mensaje: 'No tienes pacientes registrados' });
    }

    const idsPacientes = listaPacientes.map(p => p.id_paciente);

    // 2️⃣ Buscar todas las citas de esos pacientes
    const { data: citas, error: errorCitas } = await supabaseAdmin
      .from('citas')
      .select(`
        id_cita, fecha, hora_inicio, hora_fin, tipo_cita, estado,
        id_paciente,
        odontologos (id_odontologo, nombre, especialidad, sexo)
      `)
      .in('id_paciente', idsPacientes)
      .in('estado', ['pendiente', 'confirmada'])
      .order('fecha', { ascending: true })
      .order('hora_inicio', { ascending: true });

    if (errorCitas) throw errorCitas;

    // 3️⃣ Enlazar cada cita con su paciente
    const citasConPacientes = citas.map(c => {
      const paciente = listaPacientes.find(p => p.id_paciente === c.id_paciente);
      return {
        id_cita: c.id_cita,
        fecha: c.fecha,
        hora_inicio: c.hora_inicio,
        hora_fin: c.hora_fin,
        tipo_cita: c.tipo_cita,
        estado: c.estado,
        paciente: paciente
          ? {
              id_paciente: paciente.id_paciente,
              nombre_completo: paciente.nombre
            }
          : null,
        odontologo: c.odontologos
      };
    });

    res.json({
      ok: true,
      citas: citasConPacientes,
      mensaje: citasConPacientes.length ? undefined : 'No tienes citas pendientes ni confirmadas'
    });
  } catch (err) {
    console.error('obtenerCitasPorUsuario error', err);
    res.status(500).json({ ok: false, error: 'Error al obtener citas del usuario' });
  }
}

