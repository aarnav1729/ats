import sql from 'mssql';

export const MSSQL_CONFIG = {
  user: process.env.MSSQL_USER || 'PEL_DB',
  password: process.env.MSSQL_PASSWORD || 'V@aN3#@VaN',
  server: process.env.MSSQL_SERVER || '10.0.50.17',
  port: Number(process.env.MSSQL_PORT) || 1433,
  database: process.env.MSSQL_DATABASE || 'SPOT',
  requestTimeout: 60000,
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  options: {
    trustServerCertificate: true,
    encrypt: false,
    connectionTimeout: 60000,
  },
};

let poolPromise = null;

async function getSpotPool() {
  if (!poolPromise) {
    const pool = new sql.ConnectionPool(MSSQL_CONFIG);
    poolPromise = pool.connect().catch((err) => {
      poolPromise = null;
      throw err;
    });
  }

  return poolPromise;
}

function cleanValue(value) {
  return typeof value === 'string' ? value.trim() : value;
}

export async function listSpotEmployees({ search = '' } = {}) {
  const pool = await getSpotPool();
  const request = pool.request();
  let query = `
    SELECT
      LTRIM(RTRIM(EmpID)) AS employee_id,
      LTRIM(RTRIM(EmpName)) AS employee_name,
      LTRIM(RTRIM(EmpEmail)) AS employee_email,
      LTRIM(RTRIM(Dept)) AS department_name,
      LTRIM(RTRIM(SubDept)) AS sub_department_name,
      LTRIM(RTRIM(EmpLocation)) AS location_name,
      LTRIM(RTRIM(Designation)) AS designation,
      CAST(ISNULL(ActiveFlag, 1) AS bit) AS active_flag,
      LTRIM(RTRIM(ManagerID)) AS manager_id
    FROM dbo.EMP
    WHERE ISNULL(ActiveFlag, 1) = 1
      AND NULLIF(LTRIM(RTRIM(EmpName)), '') IS NOT NULL
  `;

  if (search.trim()) {
    request.input('search', sql.NVarChar, `%${search.trim()}%`);
    query += `
      AND (
        EmpName LIKE @search
        OR EmpID LIKE @search
        OR EmpEmail LIKE @search
        OR Dept LIKE @search
        OR SubDept LIKE @search
      )
    `;
  }

  query += ' ORDER BY EmpName, EmpID';

  const result = await request.query(query);
  return result.recordset.map((row) => ({
    employee_id: cleanValue(row.employee_id),
    employee_name: cleanValue(row.employee_name),
    employee_email: cleanValue(row.employee_email),
    department_name: cleanValue(row.department_name),
    sub_department_name: cleanValue(row.sub_department_name),
    location_name: cleanValue(row.location_name),
    designation: cleanValue(row.designation),
    active_flag: Boolean(row.active_flag),
    manager_id: cleanValue(row.manager_id),
  }));
}

export function buildOrgMap(employees = []) {
  const byId = new Map();
  const directReports = new Map();

  for (const employee of employees) {
    if (employee?.employee_id) {
      byId.set(employee.employee_id, employee);
    }
  }

  for (const employee of employees) {
    const managerId = employee?.manager_id;
    if (!managerId) continue;
    const bucket = directReports.get(managerId) || [];
    bucket.push(employee);
    directReports.set(managerId, bucket);
  }

  return { byId, directReports };
}

export async function getSpotOrgSnapshot() {
  return listSpotEmployees();
}

export async function findSpotManagingDirector({ employeeName = 'Chiranjeev', designation = 'Managing Director' } = {}) {
  const employees = await listSpotEmployees();
  const normalizedName = employeeName.trim().toLowerCase();
  const normalizedDesignation = designation.trim().toLowerCase();

  return employees.find((employee) => (
    String(employee.designation || '').trim().toLowerCase() === normalizedDesignation
    && String(employee.employee_name || '').trim().toLowerCase().includes(normalizedName)
  )) || employees.find((employee) => (
    String(employee.designation || '').trim().toLowerCase() === normalizedDesignation
  )) || null;
}

export async function listDirectReportsForManager(managerId) {
  if (!managerId) return [];
  const employees = await listSpotEmployees();
  return employees.filter((employee) => employee.manager_id === managerId);
}

export async function listManagingDirectorDirectReports(options = {}) {
  const managingDirector = await findSpotManagingDirector(options);
  if (!managingDirector?.employee_id) {
    return { managingDirector: null, directReports: [] };
  }

  const directReports = await listDirectReportsForManager(managingDirector.employee_id);
  return {
    managingDirector,
    directReports,
  };
}
