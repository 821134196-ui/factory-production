export function translate(sql,declared) {
  const info=sql.match(/^PRAGMA table_info\((\w+)\)$/i);
  if(info && declared.has(info[1])) return "SELECT COLUMN_NAME AS name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='"+info[1]+"' ORDER BY ordinal_position";
  if(sql==='PRAGMA foreign_key_check') return 'SELECT 1 WHERE FALSE'; // InnoDB checks every write.
  if(sql==='BEGIN IMMEDIATE') return 'START TRANSACTION';
  const table=sql.match(/^CREATE TABLE IF NOT EXISTS (\w+)/i);
  if(table && declared.has(table[1])) return null; // Schema installed and checked at migration time.
  const index=sql.match(/^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)/i);
  if(index && ['worker_name_unique','shipments_date'].includes(index[1])) return null;
  sql=sql.replace(/FROM sqlite_master WHERE type='table' AND name=/ig,'FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=')
    .replaceAll("json_extract(value,'$.product.id')",'entry.product_id')
    .replaceAll('json_each(entries_json)',"JSON_TABLE(entries_json,'$[*]' COLUMNS(product_id VARCHAR(255) PATH '$.product.id')) AS entry")
    .replace('sequence,* FROM records','sequence,records.* FROM records')
    .replace(/^INSERT OR REPLACE INTO/i,'REPLACE INTO');
  const conflict=sql.match(/ ON CONFLICT\(([^)]+)\) DO UPDATE SET /i);
  if(conflict) {
    const guard=/^INSERT INTO users\b/i.test(sql)?'id=IF(id=VALUES(id),id,NULL),':'';
    sql=sql.replace(conflict[0],' ON DUPLICATE KEY UPDATE '+guard).replace(/excluded\.(\w+)/g,'VALUES($1)');
  }
  if(/^INSERT OR IGNORE/i.test(sql)) {
    // Suppress duplicate keys only. INSERT IGNORE also suppresses invalid values and foreign keys.
    const [,table]=sql.match(/^INSERT OR IGNORE INTO (\w+)/i);
    const key={products:'id',users:'id',records:'id',groups:'id',members:'record_id',app_meta:'key',leader_requests:'user_id',attendance:'user_id'}[table];
    if(!key) throw new Error('Unknown insert target '+table);
    sql=sql.replace(' FROM '+table+' WHERE',' FROM '+table+' AS source_rows WHERE').replace(/^INSERT OR IGNORE/i,'INSERT')+' ON DUPLICATE KEY UPDATE '+key+'='+table+'.'+key;
  }
  return sql.replace(/'(?:''|[^'])*'|\b(?:groups|precision|key|uses)\b/gi,token=>token.startsWith("'")?token:'`'+token+'`')
    .replace(/ON DUPLICATE `KEY`/gi,'ON DUPLICATE KEY');
}
