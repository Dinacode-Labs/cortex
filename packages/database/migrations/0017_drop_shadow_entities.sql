-- Fuera el grafo en sombra: entidades que eran copias de entradas (ADR-0055).
--
-- `entities.type` admitía `decision` e `incident`, que son tipos de ENTRADA. El extractor las
-- creaba con la frase entera por nombre, así que la misma decisión quedaba guardada dos veces:
-- una como entrada, con su contenido, su fuente y su vigencia, y otra como nodo del grafo
-- llamado «Publicar Cortex en abierto y monetizar la implementación (sin hosting propio)».
--
-- El daño no era el espacio, era el ruido en lo que la gente mira: esos nodos salían como
-- entidades huérfanas, y las contradicciones se detectaban ENTRE ELLOS —en una instalación
-- real, las 18 relaciones `contradicts` eran todas entre entidades y ninguna entre entradas—,
-- con pares tan poco útiles como «opción C ⟷ opción A». Un informe de salud que es medio ruido
-- enseña a no mirar el informe de salud.
--
-- Se borran los nodos, sus enlaces a entradas y sus relaciones. **No se toca ninguna entrada**:
-- el conocimiento vive ahí y sigue intacto, con su historia bi-temporal. Lo que desaparece es
-- la copia degradada. A partir de ahora el enum ya no admite estos tipos, así que no vuelven.

DELETE FROM relations r
 USING entities e
 WHERE (r.source_id = e.id OR r.target_id = e.id)
   AND e.type IN ('decision', 'incident');

DELETE FROM context_entry_entities cee
 USING entities e
 WHERE cee.entity_id = e.id
   AND e.type IN ('decision', 'incident');

DELETE FROM entities WHERE type IN ('decision', 'incident');

-- Que no puedan volver ni por SQL a mano.
ALTER TABLE entities DROP CONSTRAINT IF EXISTS entities_type_not_entry_check;
ALTER TABLE entities ADD CONSTRAINT entities_type_not_entry_check
  CHECK (type NOT IN ('decision', 'incident'));
