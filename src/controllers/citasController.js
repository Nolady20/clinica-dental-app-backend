// src/controllers/citasController.js
import { supabaseAdmin } from '../supabaseClient.js';

// Crear cita con validación de solapamiento y máximo 1 cita por día
export async function crearCita(req, res) {
  try {
    const { id_paciente, id_odontologo, fecha, hora_inicio, tipo_cita } = req.body;

    if (!id_paciente || !id_odontologo || !fecha || !hora_inicio) {
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }

    // Calcular hora_fin (bloque de 40 minutos por defecto)
    const duracionMinutos = 40; 
    const horaFinDate = new Date(`1970-01-01T${hora_inicio}`);
    horaFinDate.setMinutes(horaFinDate.getMinutes() + duracionMinutos);
    const hora_fin = horaFinDate.toISOString().substring(11, 19); // formato HH:mm:ss

    // 🔹 Validar que el paciente no tenga más de 1 cita en ese mismo día
    const { data: citasPaciente, error: errorPaciente } = await supabaseAdmin
      .from('citas')
      .select('id_cita')
      .eq('id_paciente', id_paciente)
      .eq('fecha', fecha)
      .in('estado', ['pendiente', 'confirmada']); // solo citas activas

    if (errorPaciente) throw errorPaciente;

    if (citasPaciente && citasPaciente.length > 0) {
      return res.status(409).json({ 
        error: 'El paciente ya tiene una cita registrada para este día' 
      });
    }

    // 🔹 Validar que no exista solapamiento con otra cita del mismo odontólogo
    const { data: citasExistentes, error: errorSolapamiento } = await supabaseAdmin
      .from('citas')
      .select('*')
      .eq('id_odontologo', id_odontologo)
      .eq('fecha', fecha)
      .in('estado', ['pendiente', 'confirmada']) // solo citas activas
      .or(`and(hora_inicio.lt.${hora_fin},hora_fin.gt.${hora_inicio})`);

    if (errorSolapamiento) throw errorSolapamiento;

    if (citasExistentes && citasExistentes.length > 0) {
      return res.status(409).json({ 
        error: 'El odontólogo ya tiene una cita en ese horario' 
      });
    }

    // Insertar cita
    const { data, error } = await supabaseAdmin
      .from('citas')
      .insert([{
        id_paciente,
        id_odontologo,
        fecha,
        hora_inicio,
        hora_fin,
        tipo_cita: tipo_cita || 'normal',
        estado: 'pendiente'
      }])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ ok: true, cita: data });
  } catch (err) {
    console.error('crearCita error', err);
    res.status(500).json({ error: 'Error al crear la cita' });
  }
}


// Obtener citas por paciente
export async function obtenerCitasPorPaciente(req, res) {
  try {
    const { id_paciente } = req.params;

    if (!id_paciente) {
      return res.status(400).json({ error: 'Se requiere id_paciente' });
    }

    const { data, error } = await supabaseAdmin
      .from('citas')
      .select(`
        id_cita,
        fecha,
        hora_inicio,
        hora_fin,
        tipo_cita,
        estado,
        odontologos (id_odontologo, nombre, especialidad)
      `)
      .eq('id_paciente', id_paciente)
      .order('fecha', { ascending: true })
      .order('hora_inicio', { ascending: true });

    if (error) throw error;

    res.json({ ok: true, citas: data });
  } catch (err) {
    console.error('obtenerCitasPorPaciente error', err);
    res.status(500).json({ error: 'Error al obtener citas' });
  }
}


// Reprogramar cita
export async function reprogramarCita(req, res) {
  try {
    const { id_cita } = req.params;
    const { fecha_nueva, hora_nueva, motivo } = req.body;

    if (!fecha_nueva || !hora_nueva) {
      return res.status(400).json({ error: 'Se requiere fecha_nueva y hora_nueva' });
    }

    // 1. Traer cita actual
    const { data: citaActual, error: errorCita } = await supabaseAdmin
      .from('citas')
      .select('*')
      .eq('id_cita', id_cita)
      .single();

    if (errorCita || !citaActual) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    const { id_paciente, id_odontologo, fecha: fecha_anterior, hora_inicio: hora_anterior } = citaActual;

    // 2. Calcular nueva hora_fin (40 minutos por defecto)
    const duracionMinutos = 40;
    const horaFinDate = new Date(`1970-01-01T${hora_nueva}`);
    horaFinDate.setMinutes(horaFinDate.getMinutes() + duracionMinutos);
    const hora_fin_nueva = horaFinDate.toISOString().substring(11, 19);

    // 3. Validar que el paciente no tenga otra cita en el mismo día (excepto esta misma)
    const { data: citasPaciente, error: errorPaciente } = await supabaseAdmin
      .from('citas')
      .select('id_cita')
      .eq('id_paciente', id_paciente)
      .eq('fecha', fecha_nueva)
      .in('estado', ['pendiente', 'confirmada'])
      .neq('id_cita', id_cita);

    if (errorPaciente) throw errorPaciente;

    if (citasPaciente && citasPaciente.length > 0) {
      return res.status(409).json({
        error: 'El paciente ya tiene otra cita registrada para este día',
      });
    }

    // 4. Validar solapamiento con otras citas del odontólogo
    const { data: citasExistentes, error: errorSolapamiento } = await supabaseAdmin
      .from('citas')
      .select('*')
      .eq('id_odontologo', id_odontologo)
      .eq('fecha', fecha_nueva)
      .in('estado', ['pendiente', 'confirmada'])
      .neq('id_cita', id_cita)
      .or(`and(hora_inicio.lt.${hora_fin_nueva},hora_fin.gt.${hora_nueva})`);

    if (errorSolapamiento) throw errorSolapamiento;

    if (citasExistentes && citasExistentes.length > 0) {
      return res.status(409).json({
        error: 'El odontólogo ya tiene otra cita en ese horario',
      });
    }

    // 5. Guardar reprogramación en historial
    const { error: errorHist } = await supabaseAdmin
      .from('cita_reprogramaciones')
      .insert([{
        id_cita,
        fecha_anterior,
        hora_anterior,
        fecha_nueva,
        hora_nueva,
        motivo: motivo || null,
      }]);

    if (errorHist) throw errorHist;

    // 6. Actualizar la cita con nueva fecha y hora
    const { data: citaActualizada, error: errorUpdate } = await supabaseAdmin
      .from('citas')
      .update({
        fecha: fecha_nueva,
        hora_inicio: hora_nueva,
        hora_fin: hora_fin_nueva,
      })
      .eq('id_cita', id_cita)
      .select()
      .single();

    if (errorUpdate) throw errorUpdate;

    res.json({ ok: true, cita: citaActualizada });
  } catch (err) {
    console.error('reprogramarCita error', err);
    res.status(500).json({ error: 'Error al reprogramar la cita' });
  }
}

// Obtener rango de fechas disponibles (hoy + 15 días)
export async function obtenerFechasDisponibles(req, res) {
  try {
    const hoy = new Date(); // fecha actual
    const fechasDisponibles = [];

    // Generar 15 días (incluyendo hoy)
    for (let i = 0; i < 15; i++) {
      const fecha = new Date(hoy);
      fecha.setDate(hoy.getDate() + i);
      const formatoISO = fecha.toISOString().split('T')[0]; // YYYY-MM-DD
      fechasDisponibles.push(formatoISO);
    }

    return res.json({ ok: true, fechas: fechasDisponibles });
  } catch (err) {
    console.error('Error al obtener fechas disponibles:', err);
    res.status(500).json({ error: 'Error al generar fechas disponibles' });
  }
}

// Obtener odontólogos (opcionalmente filtrados por fecha si quieres)
export async function obtenerDoctores(req, res) {
  try {
    // Si quieres filtrar por fecha en el futuro puedes recibir `req.query.fecha`
    const { data, error } = await supabaseAdmin
      .from('odontologos')
      .select('id_odontologo, nombre, especialidad');

    if (error) throw error;

    return res.json({ ok: true, doctores: data });
  } catch (err) {
    console.error('obtenerDoctores error', err);
    res.status(500).json({ error: 'Error al obtener odontólogos' });
  }
}

// Obtener horarios disponibles para un odontólogo en una fecha determinada
export async function obtenerHorariosPorOdontologo(req, res) {
  try {
    const id_odontologo = req.params.id;
    const fecha = req.query.fecha; // YYYY-MM-DD

    if (!fecha) {
      return res.status(400).json({ error: 'Se requiere fecha (query param)'} );
    }

    // Definir los posibles slots (mañana/tarde) en formato HH:mm:ss
    const duracionMinutos = 40;
    const slotsManana = ['07:00:00','08:00:00','09:00:00','10:00:00','11:00:00'];
    const slotsTarde  = ['14:00:00','15:00:00','16:00:00','17:00:00'];
    const candidateSlots = [...slotsManana, ...slotsTarde];

    // Traer citas existentes de ese odontólogo en la fecha
    const { data: citasExistentes, error } = await supabaseAdmin
      .from('citas')
      .select('hora_inicio, hora_fin, estado')
      .eq('id_odontologo', id_odontologo)
      .eq('fecha', fecha)
      .in('estado', ['pendiente', 'confirmada']);

    if (error) throw error;

    // Función para sumar minutos a un time string HH:mm:ss
    const addMinutes = (timeStr, minutes) => {
      const [h, m, s] = timeStr.split(':').map(Number);
      const date = new Date(1970,0,1,h,m,s);
      date.setMinutes(date.getMinutes() + minutes);
      const hh = String(date.getHours()).padStart(2,'0');
      const mm = String(date.getMinutes()).padStart(2,'0');
      const ss = String(date.getSeconds()).padStart(2,'0');
      return `${hh}:${mm}:${ss}`;
    };

    // Función de solapamiento: slot [inicio, fin) se solapa si existe cita tal que
    // cita.hora_inicio < slotFin && cita.hora_fin > slotInicio
    const available = candidateSlots.filter(slot => {
      const slotInicio = slot;
      const slotFin = addMinutes(slot, duracionMinutos);

      // comprobar contra todas las citas existentes
      for (const cita of citasExistentes) {
        const citaInicio = cita.hora_inicio; // HH:mm:ss
        const citaFin = cita.hora_fin;
        if ( (citaInicio < slotFin) && (citaFin > slotInicio) ) {
          // solapa -> slot no disponible
          return false;
        }
      }
      return true;
    });

    return res.json({ ok: true, horarios: available });
  } catch (err) {
    console.error('obtenerHorariosPorOdontologo error', err);
    res.status(500).json({ error: 'Error al obtener horarios' });
  }
}

