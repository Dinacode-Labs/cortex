-- Quitar el título repetido de los resúmenes que ya estaban guardados (ADR-0054).
--
-- El destilador escribe el contenido como «Título. Cuerpo…» y el resumen son sus primeros
-- caracteres, así que el resumen empezaba repitiendo el título: en un proyecto real, 355 de
-- 355 entradas. El pack pinta título y resumen uno debajo del otro, con títulos de ~47
-- caracteres sobre resúmenes de ~206, así que era casi una cuarta parte de cada entrada
-- diciendo dos veces lo mismo — y el presupuesto del hook se paga en entradas que no caben.
--
-- El arreglo en `saveContext` solo actúa al guardar, así que sin esto la memoria que ya
-- existe tarda meses en beneficiarse. Se aplica aquí la misma regla que en el código: quitar
-- solo si el resumen empieza de verdad por el título y queda un resumen que merezca la pena.

UPDATE context_entries
   SET summary = trim(leading ' .:;,-' from substr(summary, length(title) + 1))
 WHERE summary IS NOT NULL
   AND length(title) >= 8
   AND lower(left(summary, length(title))) = lower(title)
   AND length(trim(leading ' .:;,-' from substr(summary, length(title) + 1))) >= 40;
