// src/controllers/tratamientosController.js
import { supabaseAdmin } from '../supabaseClient.js';

/* ========================================================
   📋 OBTENER TODOS LOS TRATAMIENTOS
   ======================================================== */
export async function obtenerTratamientos(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('tratamientos')
      .select('id_tratamiento, nombre, descripcion, duracion_estimada, costo')
      .order('id_tratamiento', { ascending: true });

    if (error) throw error;

    res.json({
      ok: true,
      tratamientos: data,
      mensaje: data?.length ? undefined : 'No hay tratamientos disponibles'
    });
  } catch (err) {
    console.error('obtenerTratamientos error:', err);
    res.status(500).json({ ok: false, error: 'Error al obtener tratamientos' });
  }
}

/* ========================================================
   🔍 OBTENER TRATAMIENTO POR ID
   ======================================================== */
export async function obtenerTratamientoPorId(req, res) {
  try {
    const { id } = req.params;

    const { data, error } = await supabaseAdmin
      .from('tratamientos')
      .select('id_tratamiento, nombre, descripcion, duracion_estimada, costo')
      .eq('id_tratamiento', id)
      .single();

    if (error) throw error;

    res.json({ ok: true, tratamiento: data });
  } catch (err) {
    console.error('obtenerTratamientoPorId error:', err);
    res.status(500).json({ ok: false, error: 'Error al obtener tratamiento' });
  }
}
