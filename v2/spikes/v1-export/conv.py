import json,re,subprocess,sys
P,src,out=sys.argv[1:4]
svg=subprocess.run([P,'svg',src],capture_output=True,text=True).stdout
sol=json.loads(subprocess.run([P,'solve','--json',src],capture_output=True,text=True).stdout)
walls=[];byid={}
for m in re.finditer(r'class="wall( stub)?" data-id="([^"]+)"><rect x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="(\d+)" fill="([^"]+)"',svg):
    stub,wid,x,y,w,h,fill=m.group(1),m.group(2),*map(int,m.group(3,4,5,6)),m.group(7)
    horiz = w>=h
    if horiz: a={'x':x,'y':y+h//2}; b={'x':x+w,'y':y+h//2}; t=h
    else: a={'x':x+w//2,'y':y}; b={'x':x+w//2,'y':y+h}; t=w
    v={'id':wid,'a':a,'b':b,'thickness':t,'phase':'existing'}
    if wid.endswith(':outer') or ':outer#' in wid: v['exterior']=True
    if fill=='#4a4a4a': v['loadBearing']=True
    walls.append(v); byid[wid]=(v,horiz)
ops=[]
for o in sol['openings']:
    w,horiz=byid[o['wall']]
    room,side=o['id'][2:].rsplit(':',1)[0].split('.')
    f=sol['faces'][room]
    lo = f['west'] if side in('north','south') else f['north']
    start=lo+o['at']
    off=start-(w['a']['x'] if horiz else w['a']['y'])
    k={'door':'door','window':'window','passage':'opening'}[o['kind']]
    v={'id':o['id'],'wallId':o['wall'],'kind':k,'offset':off,'width':o['width'],'phase':'existing'}
    if k=='opening': v['through']=True
    if o.get('hinge'):
        v['hinge']='a' if o['hinge'] in('west','north') else 'b'
        into=o.get('opens_into',room)
        # side of the wall the leaf swings to, seen from a->b (a west->east or north->south)
        if horiz:  # a->b points east; left = north
            target_north = (into==room and side=='south') or (into!=room and side=='north')
            v['swing']='left' if target_north else 'right'
        else:      # a->b points south; left = east
            target_east = (into==room and side=='west') or (into!=room and side=='east')
            v['swing']='left' if target_east else 'right'
    ops.append(v)
rooms=[{'id':n,'name':n,'at':{'x':(f['west']+f['east'])//2,'y':(f['north']+f['south'])//2},
        'polygon':[{'x':f['west'],'y':f['north']},{'x':f['east'],'y':f['north']},{'x':f['east'],'y':f['south']},{'x':f['west'],'y':f['south']}]} for n,f in sol['faces'].items()]
plan={'id':'spike','name':'Spike: v2 solve -> v1 plan','sheet':{'paper':'A3','orientation':'landscape','scale':50,'northAngle':0,
  'titleBlock':{'project':'v2 → v1','property':'Stockholm Gnejsen 6','address':'','apartments':'Lgh 154','floor':'','drawingNumber':'A-01','author':'v2 kernel','date':'2026-11-11','revision':''}},
  'walls':walls,'openings':ops,'fixtures':[],'rooms':rooms,'dimensions':[],'notes':[]}
json.dump(plan,open(out,'w'),ensure_ascii=False,indent=1); print(len(walls),'walls',len(ops),'openings',len(rooms),'rooms')
