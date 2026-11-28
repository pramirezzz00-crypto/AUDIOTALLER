"""Los manejadores en línea (onclick="…") no pueden llamar funciones globales tapadas por el documento.

Dentro de onclick="…" el navegador busca los nombres primero en el elemento y en `document`.
Una función global de la app con el mismo nombre que algo del documento queda tapada:
el botón de carpeta de Plugins llamaba `body(...)` y obtenía `document.body` («body is not
a function»), así que no hacía nada y no mostraba ningún error.
"""
import re
import unittest
from pathlib import Path

STATIC = Path(__file__).resolve().parents[1] / 'static'

# Nombres que el navegador resuelve antes que las funciones globales dentro de un manejador en línea
# (propiedades de `document` y de los elementos donde la app pone manejadores).
SHADOWED = {
    'body', 'head', 'title', 'open', 'close', 'write', 'writeln', 'forms', 'images', 'links', 'scripts',
    'location', 'domain', 'cookie', 'fonts', 'hidden', 'children', 'append', 'prepend', 'remove', 'click',
    'focus', 'blur', 'submit', 'reset', 'select', 'after', 'before', 'replaceWith', 'closest', 'matches',
    'animate', 'name', 'value', 'type', 'form', 'style', 'dataset', 'contains', 'normalize', 'evaluate',
    'query', 'show', 'showModal', 'getElementById', 'createElement', 'importNode', 'adoptNode', 'clear',
}
HANDLER = re.compile(r'\bon(?:click|change|input|submit|keydown|keyup|blur|focus|drag\w*|drop|load|error|toggle)="([^"]*)"')
CALL = re.compile(r'(?<![\w.$])([A-Za-z_$][\w$]*)\s*\(')
GLOBAL = re.compile(r'^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=', re.M)


class InlineHandlersTest(unittest.TestCase):
    def test_ningun_manejador_llama_una_global_tapada_por_el_documento(self):
        files = [STATIC / 'audio.html', *sorted(STATIC.glob('*.js'))]
        globals_ = {m.group(1) or m.group(2) for path in files[1:] for m in GLOBAL.finditer(path.read_text(encoding='utf-8'))}
        risky = globals_ & SHADOWED
        problems = []
        for path in files:
            for line_no, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
                for handler in HANDLER.finditer(line):
                    for call in CALL.finditer(handler.group(1)):
                        if call.group(1) in risky:
                            problems.append(f'{path.name}:{line_no} llama {call.group(1)}() en un manejador en línea')
        self.assertEqual(problems, [], 'Mové la llamada a una función con nombre propio (como plgReveal).')

    def test_la_prueba_detecta_el_caso_del_boton_de_plugins(self):
        old = '''onclick="api('/api/plugins/mostrar',body({ruta:${esc(JSON.stringify(p.ruta))}})).catch(report)"'''
        calls = {c.group(1) for h in HANDLER.finditer(old) for c in CALL.finditer(h.group(1))}
        self.assertIn('body', calls & SHADOWED)


if __name__ == '__main__':
    unittest.main()
