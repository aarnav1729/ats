import { Router } from 'express';
import pool from '../db.js';

const router = Router();

router.get('/jobs/:jobId', async (req, res) => {
  try {
    const param = req.params.jobId;
    const isNumeric = /^\d+$/.test(param);

    const result = await pool.query(
      `SELECT
          j.id,
          j.job_id,
          j.job_title,
          j.job_description,
          j.job_type,
          j.status,
          j.total_positions,
          j.experience_years,
          j.compensation_min,
          j.compensation_max,
          j.compensation_currency AS currency,
          j.publish_to_careers,
          bu.bu_name,
          bu.bu_short_name,
          d.department_name,
          sd.sub_department_name,
          l.location_name,
          p.phase_name
       FROM jobs j
       LEFT JOIN business_units bu ON j.business_unit_id = bu.id
       LEFT JOIN departments d ON j.department_id = d.id
       LEFT JOIN sub_departments sd ON j.sub_department_id = sd.id
       LEFT JOIN locations l ON j.location_id = l.id
       LEFT JOIN phases p ON j.phase_id = p.id
       WHERE (j.job_id = $1 ${isNumeric ? 'OR j.id = ' + parseInt(param, 10) : ''})
         AND j.active_flag = true
         AND LOWER(COALESCE(j.status, 'draft')) NOT IN ('archived')
       LIMIT 1`,
      [param]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found or not published' });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Public job fetch error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
