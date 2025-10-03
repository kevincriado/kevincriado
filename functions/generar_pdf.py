import json

def handler(event, context):
    """
    Función de prueba "Hola Mundo" ultra-simple.
    No tiene dependencias externas. Si esto no se despliega,
    el problema es la configuración base de Python en Netlify.
    """
    try:
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json'
            },
            'body': json.dumps({
                'message': '¡ÉXITO! La función de Python se está desplegando y ejecutando.'
            })
        }
    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps({
                'message': 'La función de prueba "Hola Mundo" falló.',
                'error': str(e)
            })
        }

