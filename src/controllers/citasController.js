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
