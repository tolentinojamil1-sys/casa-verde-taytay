import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const $=id=>document.getElementById(id), out=$('msg');
const ready=Boolean(window.CV_SUPABASE_URL && window.CV_SUPABASE_ANON_KEY);
const db=ready?createClient(window.CV_SUPABASE_URL,window.CV_SUPABASE_ANON_KEY):null;
function iso(d){return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)}
const today=iso(new Date());$('in').min=today;$('out').min=today;$('month').value=today.slice(0,7);
for(let i=1;i<=10;i++)$('guests').add(new Option(i+' guest'+(i===1?'':'s'),String(i),false,i===10));
$('submit').disabled=!ready;if(!ready){out.textContent='Bookings are being configured. Please contact Casa Verde directly.';out.className='err';}
async function calendar(){if(!ready){$('dates').textContent='Booking calendar is not configured yet.';return}
const m=$('month').value;if(!/^\d{4}-\d{2}$/.test(m))return;const first=m+'-01';const d=new Date(first+'T12:00:00');d.setMonth(d.getMonth()+1);const end=iso(d);const {data,error}=await db.rpc('cv_public_calendar',{p_from:first,p_to:end});if(error){$('dates').textContent='Availability temporarily unavailable.';return}
if(!data.length){$('dates').textContent='No dates currently reserved or blocked for this month.';return}
$('dates').replaceChildren(...data.map(v=>{let p=document.createElement('p');p.textContent=v.check_in+' → '+v.check_out+' · '+(v.kind==='blocked'?'Unavailable':'Reserved / pending');return p}))}
$('month').addEventListener('change',calendar);
$('form').addEventListener('submit',async ev=>{ev.preventDefault();if(!ready)return;const b=$('submit');b.disabled=true;out.className='';out.textContent='Sending booking request…';
const payload={p_in:$('in').value,p_out:$('out').value,p_guests:Number($('guests').value),p_name:$('name').value,p_email:$('email').value,p_phone:$('phone').value,p_payment:$('payment').value};
const {data,error}=await db.rpc('cv_request_booking',payload);
if(error){out.textContent=error.message || 'Request failed. Please contact Casa Verde.';out.className='err'}
else{out.textContent='Request received. Booking reference: '+data+'. Please contact Casa Verde for payment instructions and confirmation.';out.className='ok';$('form').reset();await calendar()}b.disabled=false});
calendar();
