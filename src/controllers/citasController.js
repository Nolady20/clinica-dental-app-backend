// src/controllers/citasController.js
import { supabaseAdmin } from '../supabaseClient.js';
import fs from "fs";
import path from "path";
import { sendEmail } from "../utils/email.js";

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
    console.log("📩 Datos recibidos para crear cita:", req.body);

    const {
      id_paciente,
      id_odontologo,
      fecha,
      hora_inicio,
      tipo_cita = "consulta",
      id_tratamiento_paciente // 🆕 solo si es cita de tratamiento
    } = req.body;

    /* ========================================================
       1️⃣ Validar campos base
    ======================================================== */
    if (!id_paciente || !id_odontologo || !fecha || !hora_inicio) {
      return res.status(400).json({
        ok: false,
        error: "Faltan datos obligatorios"
      });
    }

    /* ========================================================
       2️⃣ Validar anticipación mínima 1 hora
    ======================================================== */
    const ahora = new Date();
    const fechaHoraSeleccionada = new Date(`${fecha}T${hora_inicio}`);
    const diffMin = (fechaHoraSeleccionada - ahora) / (1000 * 60);

    if (diffMin < 60) {
      return res.status(400).json({
        ok: false,
        error: "No puedes reservar citas con menos de 1 hora de anticipación o en horas pasadas"
      });
    }

    /* ========================================================
       3️⃣ Calcular hora fin
    ======================================================== */
    const hora_fin = calcularHoraFin(hora_inicio);

    /* ========================================================
       4️⃣ Validar que el paciente no tenga otra cita ese día
    ======================================================== */
    const { data: citasPaciente, error: errorPaciente } = await supabaseAdmin
      .from("citas")
      .select("id_cita")
      .eq("id_paciente", id_paciente)
      .eq("fecha", fecha)
      .in("estado", ["pendiente", "confirmada"]);

    if (errorPaciente) throw errorPaciente;

    if (citasPaciente?.length > 0) {
      return res.status(409).json({
        ok: false,
        error: "El paciente ya tiene una cita registrada para este día"
      });
    }

    /* ========================================================
       5️⃣ Validación de tratamiento (solo si tipo_cita = tratamiento)
    ======================================================== */
    if (tipo_cita === "tratamiento") {
      if (!id_tratamiento_paciente) {
        return res.status(400).json({
          ok: false,
          error: "Debes seleccionar un tratamiento para esta cita."
        });
      }

      const { data: tratamiento, error: errorTrat } = await supabaseAdmin
        .from("tratamiento_paciente")
        .select("id_paciente, estado")
        .eq("id_tratamiento_paciente", id_tratamiento_paciente)
        .single();

      if (errorTrat) throw errorTrat;

      if (!tratamiento) {
        return res.status(404).json({
          ok: false,
          error: "El tratamiento seleccionado no existe."
        });
      }

      if (tratamiento.id_paciente != id_paciente) {
        return res.status(403).json({
          ok: false,
          error: "Este tratamiento no pertenece al paciente seleccionado."
        });
      }

      if (tratamiento.estado !== "en_progreso") {
        return res.status(400).json({
          ok: false,
          error: "El tratamiento seleccionado no está en progreso."
        });
      }
    }

    /* ========================================================
       6️⃣ Validar solapamiento del odontólogo
    ======================================================== */
    const { data: citasExistentes, error: errorSolapamiento } = await supabaseAdmin
      .from("citas")
      .select("hora_inicio, hora_fin")
      .eq("id_odontologo", id_odontologo)
      .eq("fecha", fecha)
      .in("estado", ["pendiente", "confirmada"]);

    if (errorSolapamiento) throw errorSolapamiento;

    if (haySolapamientoHorario(citasExistentes, hora_inicio, hora_fin)) {
      return res.status(409).json({
        ok: false,
        error: "El odontólogo ya tiene una cita en ese horario"
      });
    }

    /* ========================================================
       7️⃣ Insertar cita (consulta o tratamiento)
    ======================================================== */
    const { data: nuevaCita, error: errorInsert } = await supabaseAdmin
      .from("citas")
      .insert([
        {
          id_paciente,
          id_odontologo,
          fecha,
          hora_inicio,
          hora_fin,
          tipo_cita,
          estado: "pendiente",
          id_tratamiento_paciente:
            tipo_cita === "tratamiento" ? id_tratamiento_paciente : null
        }
      ])
      .select("*")
      .single();

    if (errorInsert) throw errorInsert;

    /* ========================================================
       8️⃣ Obtener datos de paciente y odontólogo
    ======================================================== */
    const [{ data: paciente }, { data: odontologo }] = await Promise.all([
      supabaseAdmin
        .from("pacientes")
        .select("id_paciente, nombre, ape_pat, ape_mat")
        .eq("id_paciente", id_paciente)
        .single(),

      supabaseAdmin
        .from("odontologos")
        .select("id_odontologo, nombre, especialidad, sexo")
        .eq("id_odontologo", id_odontologo)
        .single()
    ]);

    /* ========================================================
       9️⃣ Buscar correo del usuario vinculado al paciente
    ======================================================== */
    const { data: relacion } = await supabaseAdmin
      .from("paciente_usuario")
      .select("id_usuario")
      .eq("id_paciente", id_paciente)
      .single();

    let correoDestino = null;

    if (relacion) {
      const { data: usuario } = await supabaseAdmin
        .from("usuarios")
        .select("correo")
        .eq("id_usuario", relacion.id_usuario)
        .single();

      correoDestino = usuario?.correo || null;
    }

    /* ========================================================
       🔟 Enviar correo de confirmación (si existe correo)
    ======================================================== */
    if (correoDestino) {
      const nombrePaciente = `${paciente?.nombre || ""} ${paciente?.ape_pat || ""}`.trim();
      const nombreOdontologo = odontologo?.nombre || "Tu odontólogo";

      const htmlEmail = `
        <div style="font-family: Arial; background:#f6f9fc; padding: 30px;">
          <div style="max-width: 520px; margin: auto; background:#ffffff; border-radius: 15px;
                      box-shadow: 0 4px 12px rgba(0,0,0,0.08); padding: 30px;">

            <h2 style="color:#2545B8; text-align:center; margin-top:0;">🦷 Confirmación de Cita</h2>

            <p>Hola <strong>${nombrePaciente}</strong>, tu cita ha sido registrada:</p>

            <p><strong>📅 Fecha:</strong> ${fecha}<br>
            <strong>⏰ Hora:</strong> ${hora_inicio}<br>
            <strong>👨‍⚕️ Odontólogo:</strong> ${nombreOdontologo}<br>
            <strong>🏷 Tipo:</strong> ${tipo_cita}</p>

            <p>Te esperamos en SaiDent.</p>
          </div>
        </div>
      `;

      await sendEmail({
        to: correoDestino,
        subject: "Tu cita ha sido registrada ✔",
        html: htmlEmail
      });
    }

    /* ========================================================
       🔥 RESPUESTA FINAL
    ======================================================== */

    res.status(201).json({
      ok: true,
      mensaje: "Cita creada exitosamente (correo enviado)",
      cita: {
        ...nuevaCita,
        paciente: {
          id_paciente,
          nombre_completo: `${paciente?.nombre || ""} ${paciente?.ape_pat || ""} ${paciente?.ape_mat || ""}`.trim()
        },
        odontologo
      }
    });

  } catch (err) {
    console.error("crearCita error", err);
    res.status(500).json({
      ok: false,
      error: "Error interno al crear la cita"
    });
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
   🔁 REPROGRAMAR CITA (Con correo profesional + logo SaiDent)
   ======================================================== */

export async function reprogramarCita(req, res) {
  try {
    const { id_cita } = req.params;
    const { fecha_nueva, hora_nueva, motivo, id_odontologo_nuevo } = req.body;

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

    /* ========================================================
   🚫 Validar que no pueda reprogramar más de 14 días 
   ======================================================== */
const hoy = new Date();
const fechaLimite = new Date();
fechaLimite.setDate(hoy.getDate() + 14);

const fechaNuevaDate = new Date(`${fecha_nueva}T${hora_nueva}`);

if (fechaNuevaDate > fechaLimite) {
  return res.status(400).json({
    ok: false,
    error: "Solo puedes reprogramar con un máximo de 2 semanas de anticipación"
  });
}


    // 1️⃣ Obtener la cita actual
    const { data: citaActual, error: errorCita } = await supabaseAdmin
      .from('citas')
      .select('*')
      .eq('id_cita', id_cita)
      .single();

    if (!citaActual)
      return res.status(404).json({ ok: false, error: 'Cita no encontrada' });

    if (citaActual.estado !== 'pendiente') {
      return res.status(409).json({ ok: false, error: 'Solo puedes reprogramar citas pendientes' });
    }

    const hora_fin_nueva = calcularHoraFin(hora_nueva);

    // Doctor actual
    const odontologoAnterior = citaActual.id_odontologo;
    let odontologoElegido = odontologoAnterior;

    /* ========================================================
       🦷 2️⃣ Cambio de odontólogo (opcional)
       ======================================================== */
    if (id_odontologo_nuevo && id_odontologo_nuevo != odontologoAnterior) {

      // Validar que exista
      const { data: existsNuevo } = await supabaseAdmin
        .from("odontologos")
        .select("id_odontologo")
        .eq("id_odontologo", id_odontologo_nuevo)
        .single();

      if (!existsNuevo)
        return res.status(404).json({ ok: false, error: "El odontólogo nuevo no existe" });

      odontologoElegido = id_odontologo_nuevo;
    }

    /* ========================================================
       3️⃣ Validar conflicto CON EL DOCTOR ELEGIDO
       ======================================================== */
    const { data: citasExistentes } = await supabaseAdmin
      .from('citas')
      .select('hora_inicio, hora_fin')
      .eq('id_odontologo', odontologoElegido)
      .eq('fecha', fecha_nueva)
      .in('estado', ['pendiente', 'confirmada'])
      .neq('id_cita', id_cita);

    if (haySolapamientoHorario(citasExistentes, hora_nueva, hora_fin_nueva)) {
      return res.status(409).json({
        ok: false,
        error: 'El odontólogo seleccionado ya tiene una cita en ese horario'
      });
    }

    /* ========================================================
       4️⃣ Validar que el paciente no tenga otra cita ese día
       ======================================================== */
    const { data: citasPaciente } = await supabaseAdmin
      .from('citas')
      .select('id_cita')
      .eq('id_paciente', citaActual.id_paciente)
      .eq('fecha', fecha_nueva)
      .neq('id_cita', id_cita)
      .in('estado', ['pendiente', 'confirmada']);

    if (citasPaciente?.length > 0)
      return res.status(409).json({ ok: false, error: 'El paciente ya tiene otra cita ese día' });

    /* ========================================================
       5️⃣ Registrar reprogramación (con doctor anterior/nuevo)
       ======================================================== */

    await supabaseAdmin.from('cita_reprogramaciones').insert([{
      id_cita,
      fecha_anterior: citaActual.fecha,
      hora_anterior: citaActual.hora_inicio,
      fecha_nueva,
      hora_nueva,
      motivo: motivo || null,
      id_odontologo_anterior: odontologoAnterior,
      id_odontologo_nuevo: odontologoElegido
    }]);

    /* ========================================================
       6️⃣ Actualizar la cita
       ======================================================== */

    const { data: citaActualizada, error: errorUpdate } = await supabaseAdmin
      .from('citas')
      .update({
        fecha: fecha_nueva,
        hora_inicio: hora_nueva,
        hora_fin: hora_fin_nueva,
        id_odontologo: odontologoElegido
      })
      .eq('id_cita', id_cita)
      .select(`
        *,
        pacientes(id_paciente, nombre),
        odontologos(id_odontologo, nombre)
      `)
      .single();

    if (errorUpdate) throw errorUpdate;

    /* ========================================================
       🖼️ 7️⃣ Cargar imagen del logo como attachment inline CID
       ======================================================== */

    const logoPath = path.resolve("src/utils/image_10.png");
    const logoBase64 = fs.readFileSync(logoPath).toString("base64");

    /* ========================================================
       8️⃣ Obtener correo del paciente
       ======================================================== */

    const { data: relacion } = await supabaseAdmin
      .from('paciente_usuario')
      .select('id_usuario')
      .eq('id_paciente', citaActual.id_paciente)
      .single();

    let correoDestino = null;

    if (relacion) {
      const { data: usuario } = await supabaseAdmin
        .from('usuarios')
        .select('correo')
        .eq('id_usuario', relacion.id_usuario)
        .single();

      correoDestino = usuario?.correo || null;
    }

    /* ========================================================
       9️⃣ ENVIAR CORREO
       ======================================================== */

    if (correoDestino) {

      const htmlEmail = `
      <div style="font-family: Arial, sans-serif; background:#f6f9fc; padding: 30px;">
        <div style="max-width: 520px; margin: auto; background:#ffffff; border-radius: 15px; 
                    box-shadow: 0 4px 12px rgba(0,0,0,0.08); padding: 30px;">

          <div style="text-align:center; margin-bottom:20px;">
            <img src="https://gqzmibsyfmyrjlxqfxed.supabase.co/storage/v1/object/public/assets/image_10.png" 
     style="width:120px; border-radius:12px;" 
     alt="SaiDent" />

          </div>

          <h2 style="color:#2545B8; text-align:center; margin-top:0;">
            🦷 Reprogramación de tu Cita
          </h2>

          <p style="font-size:16px; color:#333;">Hola <strong>${citaActualizada.pacientes?.nombre}</strong>,</p>

          <p style="font-size:15px; color:#555;">
            Tu cita ha sido <strong>reprogramada exitosamente</strong>. Aquí los detalles:
          </p>

          <div style="background:#f0f4ff; border-left:4px solid #2545B8; padding:15px 20px;
                      border-radius:6px; margin:20px 0;">
            <p style="margin:0; font-size:15px; color:#333;">
              <strong>🗓 Nueva Fecha:</strong> ${fecha_nueva}<br>
              <strong>⏰ Nueva Hora:</strong> ${hora_nueva}<br>
              <strong>👨‍⚕️ Odontólogo:</strong> ${citaActualizada.odontologos?.nombre}
            </p>
          </div>

          <p style="font-size:15px; color:#555;">
            Si no solicitaste este cambio, contáctanos inmediatamente.
          </p>

          <p style="margin-top:30px; font-size:13px; color:#999; text-align:center;">
            SaiDent © 2025 · Gestión Odontológica
          </p>
        </div>
      </div>`;

      await sendEmail({
        to: correoDestino,
        subject: "Tu cita ha sido reprogramada ✔",
        html: htmlEmail,
        // Attachment inline:
        attachments: [
          {
            content: logoBase64,
            filename: "logo.png",
            type: "image/png",
            disposition: "inline",
            content_id: "logo_saident"
          }
        ]
      });
    }

    res.json({
      ok: true,
      mensaje: "Cita reprogramada exitosamente (correo enviado)",
      cita: citaActualizada
    });

  } catch (err) {
    console.error("reprogramarCita error", err);
    res.status(500).json({ ok: false, error: "Error al reprogramar la cita" });
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
    const slotsTarde  = ['14:00:00','15:00:00','16:00:00','17:00:00','18:00:00','19:00:00','20:00:00'];
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
  pacientes (id_paciente, nombre, ape_pat, ape_mat)
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
              nombre_completo: `${paciente.nombre} ${paciente.ape_pat} ${paciente.ape_mat}`.trim()
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


/* ========================================================
   🦷 LISTAR TRATAMIENTOS EN PROGRESO DE UN PACIENTE
   ======================================================== */
export async function obtenerTratamientosEnProgreso(req, res) {
  try {
    const { id_paciente } = req.params;

    if (!id_paciente)
      return res.status(400).json({ ok: false, error: "Falta id_paciente" });

    const { data, error } = await supabaseAdmin
      .from("tratamiento_paciente")
      .select(`
        id_tratamiento_paciente,
        estado,
        fecha_inicio,
        tratamientos (
          id_tratamiento,
          nombre,
          descripcion,
          costo
        )
      `)
      .eq("id_paciente", id_paciente)
      .eq("estado", "en_progreso");

    if (error) throw error;

    return res.json({
      ok: true,
      tratamientos: data
    });

  } catch (err) {
    console.error("obtenerTratamientosEnProgreso error", err);
    res.status(500).json({ ok: false, error: "Error al obtener tratamientos" });
  }
}
