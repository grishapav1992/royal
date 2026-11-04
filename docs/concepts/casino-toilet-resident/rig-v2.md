# Спрайт по выбранному референсу

Источник: [выбранный вариант 1](selected-reference-v1.png). Предыдущая отрисовка примитивами не соответствовала лицу и пропорциям этого рисунка, поэтому заменена атласом из тела и двух предплечий. Тело отображается с равномерным масштабом, без сжатия по вертикали. Руки поворачиваются у манжет, жест скрывается за рубашкой. Геометрия комнаты и закрытая дверь не меняются.

Инструмент: встроенный imagegen, прозрачный PNG 1536x1024. Файл: `public/assets/toilet/visitor-rig-v2-161e9417f4a0.png`. SHA256: `161e9417f4a05d059e1f06b7ff220f1a85d130f7a926b642c9f958bb09dc2a68`.

Итоговый запрос:

```text
Use case: identity-preserve.
Asset type: transparent 2D game character rig atlas, based strictly on the selected reference image.
The attached image is the APPROVED character design, variant 1. Extract and faithfully reproduce that exact seated adult male visitor, preserving his very large round head, soft tousled black side-parted hair, thick dark eyebrows, large round half-lidded off-white eyes with small pupils, small black moustache ABOVE the mouth (NO beard), tired open mouth with little upper teeth, light warm skin, wide loose teal button shirt with collar and a chest pocket, irregular bubbly white SOAP FOAM on hair, both cheeks, shoulders and shirt. Trousers bunched at ankles, broad dark shoes, modest seated pose. No genitals, no buttocks, no excrement, no sexual content. His long shirt covers his lap. Preserve the reference's exact expression, outline, head/body proportions, palette, white foam placement, and illustration quality. Do not invent a new character or simplify into angular polygons.

Create ONE clean transparent-background LANDSCAPE rigging atlas (prefer 1536x1024).
LEFT TWO THIRDS: one seated full body sprite, facing straight toward viewer, from hair to shoes, vertically upright like reference. No toilet, no cistern, no walls, no floor, no paper debris, no number label. Shirt sleeves include their rolled cuffs. For the animation rig, render the forearm-and-hand parts as SEPARATE PIECES on the right, so the main body has clean transparent space below its two cuffs. Continue the teal shirt silhouette behind the removable arms. Keep knees and trouser waistband as in reference, lap concealed. This is a flat paper-cutout cartoon rig, no wounds or severed anatomy.
RIGHT THIRD: only two separate forearm-and-hand sprites, at exactly the same pixel scale as the body. Upper right is the man's left forearm with relaxed loosely curled fingers, lower right is his right forearm with relaxed loosely curled fingers. Include the small rolled teal cuff at each forearm top, arms extend down toward the hands as in the approved resting pose. Soft rounded fingers matching the reference. Leave generous transparent gaps around each separate part. The right side contains only these two parts, not extra heads or complete characters.
All parts have the same line weight, the same warm skin color and same lighting as the reference. Keep the full body unmoved and symmetrical, knees bent for sitting. Flat 2D illustrated game sprite. Real transparent alpha outside the parts. No checkerboard painted into the image. No texts, no arrows, no outlines of cells, no gradients in the background.
```
