import json,sys
src,out=sys.argv[1:3]
plan=json.load(open(src))   # the centre-line plan from the first spike (v2 rects as centre lines)
faces={r['id']:r['polygon'] for r in plan['rooms']}
W=min(p[0]['x'] for p in faces.values()); E=max(p[1]['x'] for p in faces.values())
side_ref={'east':'right','north':'right','west':'left','south':'left'}
for w in plan['walls']:
    first=w['id'][2:].split('|')[0].split(':')[0]; room,side=first.split('.')
    t=w['thickness']; h=t/2
    horiz = w['a']['y']==w['b']['y']
    if horiz:
        yc=w['a']['y']; y = yc+h if side=='north' else yc-h      # the room face: south edge of a north wall
        x0,x1=w['a']['x'],w['b']['x']
        if w.get('exterior'):
            nx0=max(x0,W)
            for o in plan['openings']:
                if o['wallId']==w['id']: o['offset']-= (nx0-x0)   # offsets were from the extended end
            x0,x1=nx0,min(x1,E)          # undo the drawing's corner extension
        w['a']={'x':x0,'y':round(y)}; w['b']={'x':x1,'y':round(y)}
    else:
        xc=w['a']['x']; x = xc-h if side=='east' else xc+h       # east face of room = west edge of the wall
        w['a']={'x':round(x),'y':w['a']['y']}; w['b']={'x':round(x),'y':w['b']['y']}
    w['ref']=side_ref[side]
json.dump(plan,open(out,'w'),ensure_ascii=False,indent=1)
