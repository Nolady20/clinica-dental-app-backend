// src/controllers/authController.js
import { supabaseAdmin, supabaseAnon } from '../supabaseClient.js';

import { sendEmail } from "../utils/email.js";

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

    // 1) Buscar paciente por numero_documento
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
      return res.status(401).json({ error: 'Número de documento o contraseña inválidos' });
    }

    // 2) Obtener usuario asociado
    let usuarioRow = null;

    if (paciente.id_usuario) {
      const { data: uData, error: uErr } = await supabaseAdmin
        .from('usuarios')
        .select('id_usuario, auth_id, correo, rol, creado_en, activo')
        .eq('id_usuario', paciente.id_usuario)
        .maybeSingle();

      if (uErr) {
        console.error('Error obteniendo usuario asociado:', uErr);
        return res.status(500).json({ error: 'Error buscando usuario' });
      }

      usuarioRow = uData;

    } else {
      const { data: rel, error: relErr } = await supabaseAdmin
        .from('paciente_usuario')
        .select('id_usuario, rol_relacion, estado, usuarios ( id_usuario, auth_id, correo, rol, activo )')
        .eq('id_paciente', paciente.id_paciente)
        .eq('estado', true)
        .limit(1)
        .maybeSingle();

      if (relErr) {
        console.error('Error buscando relacion paciente_usuario:', relErr);
        return res.status(500).json({ error: 'Error buscando usuario' });
      }

      if (rel?.usuarios) usuarioRow = rel.usuarios;
    }

    if (!usuarioRow || !usuarioRow.correo) {
      return res.status(400).json({ error: 'No hay un usuario asociado a este paciente' });
    }

    // ❌ Usuario desactivado
    if (usuarioRow.activo === false) {
      return res.status(403).json({ error: 'Tu cuenta está desactivada' });
    }

    // 3) Intentar login normal
    const { data: signInData, error: signInErr } = await supabaseAnon.auth.signInWithPassword({
      email: usuarioRow.correo,
      password
    });

    // -----------------------------
    // 🔥 REPARAR CONTRASEÑAS ANTIGUAS
    // -----------------------------
    if (signInErr?.message === "Invalid login credentials") {

      console.log(`Intento de reparación de contraseña para ${usuarioRow.correo}`);

      // Actualizar contraseña en Supabase Auth
      const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(
        usuarioRow.auth_id,
        { password }
      );

      if (!updateErr) {

        // Reintentar login con la nueva contraseña
        const secondTry = await supabaseAnon.auth.signInWithPassword({
          email: usuarioRow.correo,
          password
        });

        if (!secondTry.error) {

          const usuarioParaRespuesta = {
            id_usuario: usuarioRow.id_usuario,
            correo: usuarioRow.correo,
            rol: usuarioRow.rol,
            creado_en: usuarioRow.creado_en
          };

          return res.json(buildResponse(
            { ...usuarioParaRespuesta, id: secondTry.data.user.id, email: secondTry.data.user.email },
            secondTry.data.session,
            paciente
          ));
        }
      }
    }

    // ❌ Login falló y no se pudo reparar
    if (signInErr) {
      console.error("Error login:", signInErr);
      return res.status(401).json({ error: "Número de documento o contraseña inválidos" });
    }

    // 4) Login normal exitoso
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

    // 1) Validar token contra Supabase Auth
    const { data: userData, error: getUserErr } = await supabaseAnon.auth.getUser(token);
    if (getUserErr || !userData?.user) {
      return res.status(401).json({ error: 'Token inválido' });
    }

    const authUser = userData.user;

    // 2) Traer usuario en tabla `usuarios`
    const { data: usuarioRow, error: usuarioErr } = await supabaseAdmin
      .from('usuarios')
      .select('id_usuario, correo, rol, creado_en')
      .eq('auth_id', authUser.id)
      .maybeSingle();

    if (usuarioErr || !usuarioRow) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    let pacientes = [];

    if (usuarioRow.rol === 'paciente') {
      // 3a) Traer relaciones de paciente_usuario
      const { data: relaciones, error: relErr } = await supabaseAdmin
        .from('paciente_usuario')
        .select(`
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
            sexo
          )
        `)
        .eq('id_usuario', usuarioRow.id_usuario)
        .eq('estado', true);

      if (relErr) {
        console.error('Error consultando paciente_usuario:', relErr);
        return res.status(500).json({ error: 'Error consultando pacientes' });
      }

      pacientes = (relaciones || []).map(rel => ({
        ...rel.pacientes,
        rol_relacion: rel.rol_relacion
      }));

      // 3b) Traer el paciente titular asociado directamente al usuario
      const { data: pacienteTitular, error: pacErr } = await supabaseAdmin
        .from('pacientes')
        .select('id_paciente, numero_documento, tipo_documento, nombre, ape_pat, ape_mat, fecha_nacimiento, telefono, sexo')
        .eq('id_usuario', usuarioRow.id_usuario)
        .maybeSingle();

      if (pacErr) {
        console.error('Error consultando paciente titular:', pacErr);
        return res.status(500).json({ error: 'Error consultando paciente titular' });
      }

      if (pacienteTitular) {
        pacientes.unshift({   // lo ponemos primero
          ...pacienteTitular,
          rol_relacion: 'titular'
        });
      }
    }

    // 4) Responder
    return res.json({
      ok: true,
      user: {
        id: authUser.id,
        email: authUser.email,
        rol: usuarioRow.rol
      },
      profile: {
        id_usuario: usuarioRow.id_usuario,
        correo: usuarioRow.correo,
        rol: usuarioRow.rol,
        creado_en: usuarioRow.creado_en
      },
      pacientes
    });
  } catch (err) {
    console.error('me error', err);
    return res.status(500).json({ error: 'Error interno en me' });
  }
}

export async function resetPassword(req, res) {
  try {
    const { correo, numero_documento } = req.body;

    // 1) Determinar email real del usuario
    let emailToSend = correo;

    if (!emailToSend && numero_documento) {
      const { data, error } = await supabaseAdmin
        .from("pacientes")
        .select(`
          id_paciente,
          paciente_usuario (
            usuarios ( correo )
          )
        `)
        .eq("dni", numero_documento)
        .maybeSingle();

      if (error || !data || !data.paciente_usuario?.length) {
        return res.status(400).json({ error: "No se encontró un usuario asociado" });
      }

      emailToSend = data.paciente_usuario[0].usuarios.correo;
    }

    // 2) Generar OTP de 6 dígitos
    const codigo = (Math.floor(100000 + Math.random() * 900000)).toString();

    // 3) Guardarlo en Supabase
    const { error: insertErr } = await supabaseAdmin
      .from("password_reset_codes")
      .insert({
        email: emailToSend,
        codigo
      });

    if (insertErr) {
      console.error("insertErr:", insertErr);
      return res.status(500).json({ error: "No se pudo generar el código" });
    }

    /* ========================================================
       🖼️ Logo cargado desde Supabase Storage
       ======================================================== */

    const logoURL = "https://gqzmibsyfmyrjlxqfxed.supabase.co/storage/v1/object/public/assets/image_10.png";
    // ⚠️ Reemplaza por la URL real cuando subas tu logo


    /* ========================================================
       📧 4) Enviar correo con diseño profesional
       ======================================================== */

    const htmlEmail = `
      <div style="font-family: Arial, sans-serif; background:#f6f9fc; padding: 30px;">
        <div style="max-width: 520px; margin: auto; background:#ffffff; border-radius: 15px; 
                    box-shadow: 0 4px 12px rgba(0,0,0,0.08); padding: 30px;">

          <div style="text-align:center; margin-bottom:20px;">
            <img src="${logoURL}" alt="SaiDent" style="width:120px; border-radius:12px;" />
          </div>

          <h2 style="color:#2545B8; text-align:center; margin-top:0;">
            🔐 Recuperación de Contraseña
          </h2>

          <p style="font-size:16px; color:#333; text-align:center;">
            Hemos recibido una solicitud para restablecer tu contraseña.
          </p>

          <p style="font-size:15px; color:#555; text-align:center;">
            Usa el siguiente código para continuar con el proceso:
          </p>

          <div style="background:#f0f4ff; border-left:4px solid #2545B8; padding:20px; 
                      border-radius:8px; text-align:center; margin:25px 0;">
            <p style="font-size:28px; letter-spacing:6px; margin:0; color:#2545B8;">
              <strong>${codigo}</strong>
            </p>
          </div>

          <p style="font-size:14px; color:#666; text-align:center;">
            Este código expira en <strong>10 minutos</strong>.
          </p>

          <p style="margin-top:30px; font-size:13px; color:#999; text-align:center;">
            SaiDent © 2025 · Gestión Odontológica
          </p>
        </div>
      </div>
    `;

    await sendEmail({
      to: emailToSend,
      subject: "Tu código de recuperación 🔐",
      html: htmlEmail
    });

    return res.json({
      ok: true,
      message: "Código enviado al email"
    });

  } catch (err) {
    console.error("resetPassword error general:", err);
    return res.status(500).json({ error: "Error interno" });
  }
}

export async function verifyOtpAndChangePassword(req, res) {
  try {
    const { email, codigo, nueva_contrasena } = req.body;

    if (!email || !codigo || !nueva_contrasena) {
      return res.status(400).json({ error: "Faltan datos" });
    }

    // Buscar OTP válido
    const { data: otpData, error: otpErr } = await supabaseAdmin
      .from("password_reset_codes")
      .select("*")
      .eq("email", email)
      .eq("codigo", codigo)
      .eq("usado", false)
      .order("creado_en", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (otpErr || !otpData) {
      return res.status(400).json({ error: "Código inválido" });
    }

    // Verificar expiración (10 min)
    const creadoEn = new Date(otpData.creado_en);
    const ahora = new Date();
    const diffMin = (ahora - creadoEn) / 1000 / 60;

    if (diffMin > 10) {
      return res.status(400).json({ error: "Código expirado" });
    }

    // Buscar usuario por email en usuarios
    const { data: userDB, error: userErr } = await supabaseAdmin
      .from("usuarios")
      .select("auth_id")
      .eq("correo", email)
      .maybeSingle();

    if (userErr || !userDB) {
      return res.status(400).json({ error: "Usuario no encontrado" });
    }

    const authId = userDB.auth_id;

    // 🔹 Actualizar contraseña con Supabase Admin (SERVICE ROLE KEY)
    const { data: updateData, error: updateErr } =
      await supabaseAdmin.auth.admin.updateUserById(authId, {
        password: nueva_contrasena
      });

    if (updateErr) {
      console.error("updateErr:", updateErr);
      return res.status(500).json({ error: "No se pudo actualizar la contraseña" });
    }

    // Marcar código como usado
    await supabaseAdmin
      .from("password_reset_codes")
      .update({ usado: true })
      .eq("id", otpData.id);

    return res.json({ ok: true, message: "Contraseña actualizada" });

  } catch (err) {
    console.error("verifyOtpAndChangePassword error:", err);
    return res.status(500).json({ error: "Error interno" });
  }
}

export async function actualizarPerfilUsuario(req, res) {
  try {
    const authUser = req.user;
    if (!authUser?.id)
      return res.status(401).json({ error: "Usuario no autenticado" });

    const {
      nombre,
      ape_pat,
      ape_mat,
      telefono,
      direccion,
      fecha_nacimiento,
    } = req.body;

    // Obtener id_usuario + id_paciente titular
    const { data: userRow } = await supabaseAdmin
      .from("usuarios")
      .select(`
        id_usuario,
        paciente_usuario (
          id_paciente,
          rol_relacion
        )
      `)
      .eq("auth_id", authUser.id)
      .maybeSingle();

    const relacionTitular = userRow.paciente_usuario?.find(
      (r) => r.rol_relacion === "titular"
    );

    if (!relacionTitular)
      return res.status(400).json({ error: "No hay paciente titular" });

    const id_paciente = relacionTitular.id_paciente;

    const campos = {
      ...(nombre && { nombre }),
      ...(ape_pat && { ape_pat }),
      ...(ape_mat && { ape_mat }),
      ...(telefono && { telefono }),
      ...(direccion && { direccion }),
      ...(fecha_nacimiento && { fecha_nacimiento }),
    };

    const { data, error } = await supabaseAdmin
      .from("pacientes")
      .update(campos)
      .eq("id_paciente", id_paciente)
      .select()
      .single();

    if (error) throw error;

    res.json({ ok: true, usuario: data });
  } catch (err) {
    res.status(500).json({
      error: "Error al actualizar perfil de usuario",
      detail: err.message,
    });
  }
}

export async function cambiarCorreo(req, res) {
  try {
    const authUser = req.user;
    const { nuevo_correo } = req.body;

    if (!nuevo_correo)
      return res.status(400).json({ error: "Correo requerido" });

    // 1) Actualizar en Supabase Auth
    await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
      email: nuevo_correo,
    });

    // 2) Actualizar en tabla usuarios
    await supabaseAdmin
      .from("usuarios")
      .update({ correo: nuevo_correo })
      .eq("auth_id", authUser.id);

    res.json({ ok: true, mensaje: "Correo actualizado" });
  } catch (err) {
    res.status(500).json({
      error: "Error al cambiar correo",
      detail: err.message,
    });
  }
}

export async function cambiarPassword(req, res) {
  try {
    const authUser = req.user;
    const { nueva_contrasena } = req.body;

    if (!nueva_contrasena)
      return res.status(400).json({ error: "Contraseña requerida" });

    const { error } = await supabaseAdmin.auth.admin.updateUserById(
      authUser.id,
      {
        password: nueva_contrasena,
      }
    );

    if (error) throw error;

    res.json({ ok: true, mensaje: "Contraseña actualizada" });
  } catch (err) {
    res.status(500).json({
      error: "Error al cambiar contraseña",
      detail: err.message,
    });
  }
}

export async function eliminarCuenta(req, res) {
  try {
    const authUser = req.user;

    if (!authUser?.id_usuario) {
      return res.status(400).json({ error: "Usuario no encontrado" });
    }

    const idUsuario = authUser.id_usuario;

    // 1) Desactivar usuario
    const { error: userErr } = await supabaseAdmin
      .from("usuarios")
      .update({ activo: false })
      .eq("id_usuario", idUsuario);

    if (userErr) throw userErr;

    // 2) Desactivar relaciones paciente_usuario
    const { error: relErr } = await supabaseAdmin
      .from("paciente_usuario")
      .update({ estado: false })
      .eq("id_usuario", idUsuario);

    if (relErr) throw relErr;

    return res.json({
      ok: true,
      mensaje: "Cuenta eliminada (soft delete)",
    });

  } catch (err) {
    console.error("Error eliminarCuenta:", err);
    res.status(500).json({
      error: "Error al eliminar cuenta",
      detail: err.message,
    });
  }
}



