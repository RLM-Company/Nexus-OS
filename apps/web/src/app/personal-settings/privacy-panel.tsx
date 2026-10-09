'use client';
import { useCallback,useEffect,useState } from 'react';
import styles from './personal-settings.module.css';

type Status={ready:boolean;missing:string[];connected:string[];retained:string[];lifecycle:string};
type Preview={complete:true;record_count:number;original_count:number;sections:Record<string,{records:number;originals:number;collections:Record<string,number>}>;retained:string[]};
const endpoints='/api/v1/personal-settings';
async function request<T>(route:string,options?:RequestInit):Promise<T>{
  const response=await fetch(`${endpoints}${route}`,{credentials:'same-origin',cache:'no-store',...options,headers:{'Content-Type':'application/json',...options?.headers}});
  if(!response.ok){const body=await response.json().catch(()=>null) as {error?:{message?:string}}|null;
    throw new Error(body?.error?.message??`HTTP ${response.status}`);}
  return response.json() as Promise<T>;
}

export default function PrivacyPanel(){
  const [status,setStatus]=useState<Status|null>(null);
  const [preview,setPreview]=useState<Preview|null>(null);
  const [error,setError]=useState('');
  const [token,setToken]=useState('');
  const [phrase,setPhrase]=useState('');
  const [busy,setBusy]=useState(false);
  const [result,setResult]=useState('');
  const load=useCallback(async()=>{
    const current=await request<Status>('/privacy');setStatus(current);
    if(current.ready){try{setPreview(await request<Preview>('/privacy/preview'));setError('');}catch(e){setPreview(null);setError(e instanceof Error?e.message:'Невозможно проверить полноту экспорта');}}
    else{setPreview(null);setError(`Операции недоступны: ${current.missing.join(', ')||current.lifecycle}`);}
  },[]);
  useEffect(()=>{void load().catch(e=>setError(e instanceof Error?e.message:'Сервис недоступен'));},[load]);
  const download=async()=>{
    setBusy(true);setError('');
    try{
      const response=await fetch(`${endpoints}/export`,{credentials:'same-origin',cache:'no-store'});
      const body=await response.text();
      if(!response.ok)throw new Error(`Экспорт отклонён HTTP ${response.status}: ${body.slice(0,180)}`);
      const check=JSON.parse(body) as {complete?:boolean;format?:string;sections?:Record<string,unknown>};
      if(check.complete!==true||check.format!=='kosmora-owner-export-v2'||!check.sections)throw new Error('Сервер не подтвердил полноту экспорта');
      const url=URL.createObjectURL(new Blob([body],{type:'application/json;charset=utf-8'}));
      try{
        const link=document.createElement('a');link.href=url;link.download='kosmora-complete-export.json';
        document.body.append(link);link.click();link.remove();
      }finally{URL.revokeObjectURL(url);}
    }catch(e){setError(e instanceof Error?e.message:'Не удалось экспортировать без потери данных');}
    finally{setBusy(false);}
  };
  const challenge=async()=>{setBusy(true);try{const response=await request<{confirmation_token:string}>('/delete-challenge',{method:'POST'});setToken(response.confirmation_token);setError('');}catch(e){setError(e instanceof Error?e.message:'Ошибка подтверждения');}finally{setBusy(false);}};
  const remove=async()=>{
    if(!token||phrase!=='УДАЛИТЬ МОИ ДАННЫЕ')return;
    setBusy(true);setResult('');
    try{const r=await request<{deleted:true;by_store:Record<string,number>;retained:string[]}>('/delete',{method:'POST',body:JSON.stringify({confirmation_token:token,phrase})});
      setResult(`Удалено записей по хранилищам: ${Object.entries(r.by_store).map(([id,count])=>`${id}: ${count}`).join(', ')}. Учёт расходов, вход и аудит сохранены.`);
      setToken('');setPhrase('');await load();
    }catch(e){setError(`Удаление НЕ завершено. ${e instanceof Error?e.message:'Ошибка'}. Не повторяйте отправку без проверки состояния.`);await load().catch(()=>undefined);}
    finally{setBusy(false);}
  };
  return <section><h2>Мои данные и удаление</h2><p className={styles.muted}>Для снимка останавливаются активные пользовательские операции. Только полный owner-scoped экспорт. Ссылки на оригиналы требуют входа и повторной проверки владельца. Не включены секреты провайдера, действующие сеансы и системный аудит.</p>
    {!status?<p>Проверка доступности…</p>:<p>Состояние: <strong>{status.ready?'готово к операциям':`недоступно (${status.lifecycle})`}</strong></p>}
    {status?.missing.length?<p role="alert">Нет обязательных адаптеров: {status.missing.join(', ')}. Экспорт и удаление заблокированы.</p>:null}
    {preview?<><p>Проверенный состав: <strong>{preview.record_count}</strong> записей и <strong>{preview.original_count}</strong> бинарных оригиналов.</p>
      <div className={styles.scroll}><table><thead><tr><th>Хранилище</th><th>Записей</th><th>Оригиналов</th></tr></thead><tbody>{Object.entries(preview.sections).map(([name,section])=><tr key={name}><td>{name}</td><td>{section.records}</td><td>{section.originals}</td></tr>)}</tbody></table></div>
      <p className={styles.muted}>Сохраняются: {preview.retained.join('; ')}.</p>
      <button disabled={busy||!status?.ready} className={styles.download} onClick={()=>void download()}>Скачать полный JSON с манифестом оригиналов</button>
    </>:<p>Полный экспорт недоступен, пока все обязательные источники не подтвердят полноту. Частичный файл не выдаётся.</p>}
    <h3>Безвозвратное удаление</h3><p className={styles.muted}>Перед удалением все подключённые агенты останавливают задачи и блокируют поздние записи. При сбое состояние остаётся заблокированным для восстановления оператором. Реальные расходы, неопределённые резервы, сеансы входа, секреты провайдеров и системный аудит не удаляются.</p>
    {!token?<button className={styles.danger} disabled={busy||!preview||!status?.ready} onClick={()=>void challenge()}>Запросить подтверждение удаления</button>:<><label>Введите «УДАЛИТЬ МОИ ДАННЫЕ»<input autoComplete="off" value={phrase} onChange={e=>setPhrase(e.target.value)}/></label><button className={styles.danger} disabled={busy||phrase!=='УДАЛИТЬ МОИ ДАННЫЕ'} onClick={()=>void remove()}>Удалить данные из указанных хранилищ</button><button disabled={busy} onClick={()=>{setToken('');setPhrase('');}}>Отмена</button></>}
    {error&&<p role="alert">{error}</p>}{result&&<p role="status">{result}</p>}
  </section>;
}
