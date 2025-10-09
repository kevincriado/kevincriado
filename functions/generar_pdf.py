import json
import os
import base64
from google.oauth2 import service_account
from googleapiclient.discovery import build

# Define los permisos necesarios para la API de Google Drive y Docs.
SCOPES = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/documents']

def handler(event, context):
    try:
        # 1. --- Valida las Variables de Entorno de Netlify ---
        creds_base64 = os.environ.get('GOOGLE_SERVICE_ACCOUNT_CREDENTIALS')
        template_id = os.environ.get('GOOGLE_DRIVE_TEMPLATE_ID')
        folder_id = os.environ.get('GOOGLE_DRIVE_DESTINATION_FOLDER_ID')
        if not all([creds_base64, template_id, folder_id]):
            raise ValueError("Faltan una o más variables de entorno de Google en la configuración de Netlify.")

        # 2. --- Autenticación con Google usando la Cuenta de Servicio ---
        # Decodifica las credenciales desde la variable de entorno.
        creds_json = base64.b64decode(creds_base64).decode('utf-8')
        creds_info = json.loads(creds_json)
        credentials = service_account.Credentials.from_service_account_info(creds_info, scopes=SCOPES)
        
        # Construye los clientes para las APIs de Drive y Docs.
        drive_service = build('drive', 'v3', credentials=credentials)
        docs_service = build('docs', 'v1', credentials=credentials)
        
        # 3. --- Obtiene los Datos del Formulario ---
        if not event.get('body'):
            raise ValueError("No se recibieron datos en la solicitud.")
        data = json.loads(event.get('body'))
        
        session_date = data.get('FECHA_CONS', 'nodate').replace('/', '-')
        new_doc_name = f"HC_{data.get('NOMBRE_COMPLETO', 'SinNombre')}_{session_date}"

        # 4. --- Crea una Copia de la Plantilla en la Carpeta Compartida ---
        # Este es el paso clave: se crea el archivo directamente en la carpeta de destino.
        copied_file = drive_service.files().copy(
            fileId=template_id,
            body={'name': new_doc_name, 'parents': [folder_id]}
        ).execute()
        new_doc_id = copied_file.get('id')

        # 5. --- Prepara las Instrucciones para Rellenar la Plantilla ---
        # Crea una lista de reemplazos para cada marcador en la plantilla.
        requests = []
        for key, value in data.items():
            requests.append({
                'replaceAllText': {
                    'containsText': {'text': f'{{{{{key}}}}}', 'matchCase': False},
                    'replaceText': str(value)
                }
            })

        # 6. --- Actualiza el Documento Copiado ---
        # Envía todas las instrucciones de reemplazo a la API de Google Docs.
        docs_service.documents().batchUpdate(
            documentId=new_doc_id,
            body={'requests': requests}
        ).execute()

        # 7. --- Exporta el Documento Rellenado como PDF ---
        pdf_content = drive_service.files().export(
            fileId=new_doc_id,
            mimeType='application/pdf'
        ).execute()
        
        # 8. --- Elimina el Documento Temporal de Google Docs ---
        drive_service.files().delete(fileId=new_doc_id).execute()

        # 9. --- Envía el PDF al Navegador para su Descarga ---
        filename = f"{new_doc_name}.pdf"
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/pdf',
                'Content-Disposition': f'attachment; filename="{filename}"'
            },
            'body': base64.b64encode(pdf_content).decode('utf-8'),
            'isBase64Encoded': True
        }

    except Exception as e:
        # Si algo falla, captura el error y lo devuelve para depuración.
        error_detail = f"{type(e).__name__}: {e}"
        print(f"--- FUNCTION FAILED ---: {error_detail}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'message': "Error interno del servidor.",
                'error': error_detail
            })
        }

