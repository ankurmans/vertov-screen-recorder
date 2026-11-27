/** Reporting labels only; never used for authorization. Unknown passkey identities stay separate. */
export const accountCohortSql = `CASE
 WHEN lower(trim(u.email)) LIKE '%@internal.invalid' THEN 'internal'
 WHEN lower(trim(u.name))='app review' THEN 'review'
 WHEN coalesce(u.isAnonymous,0)=0 AND lower(u.email) LIKE '%.invalid' THEN 'demo'
 WHEN coalesce(u.isAnonymous,0)=0 AND instr(u.email,'@')>1 AND u.email NOT LIKE '%.invalid' THEN 'external'
 WHEN EXISTS (SELECT 1 FROM passkey p WHERE p.userId=u.id) THEN 'passkey_unknown'
 ELSE 'guest' END`
