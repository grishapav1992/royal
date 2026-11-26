import type {RigData} from './rig';
export const RIGS:Record<string,Omit<RigData,'crops'>>={
 freya:{id:'freya',neck:[440,470],head:{top:420,bottom:482,left:230,right:880},chest:{c:[480,760],r:[240,170]},feet:[512,1536],
  feather:{base:[760,180],box:[700,40,880,480]},coat:{top:1150},
  chains:[{layer:'braid',spine:[[590,390],[640,470],[690,550],[735,630],[770,710],[795,790],[805,870],[810,945]],stiff:26,heavy:1}],
  pendulums:[{layer:'earring',hook:[568,304],len:100}],forearm:{pivot:[150,875]},gestures:['win','bonus'],moves:{win:{origin:[250,540],from:-.7,lift:.8,fixed:[0,600,1024,1536]},bonus:{origin:[250,560],from:-.55,lift:.6}},hides:{forearm:['win','bonus']},character:{tempo:1,sway:1,bounce:1}},
 isabella:{id:'isabella',neck:[600,345],head:{top:300,bottom:372,left:330,right:800},chest:{c:[560,560],r:[210,150]},feet:[512,1536],
  hair:[{a:[300,330],r:[110,150],side:1},{a:[230,560],r:[90,170],side:1},{a:[690,380],r:[60,130],side:1}],coat:{top:1050},
  chains:[{layer:'scarf',spine:[[415,125],[370,190],[320,250],[265,310],[215,370],[170,425]],stiff:18,heavy:1.4}],
  forearm:{pivot:[230,880]},gestures:['win','bonus'],moves:{win:{origin:[300,430],from:-.6,lift:.7,fixed:[0,560,1024,1536]},bonus:{origin:[770,470],from:0,lift:0}},hides:{scarf:['win'],forearm:['win']},character:{tempo:.9,sway:1.2,bounce:1.1}},
};
