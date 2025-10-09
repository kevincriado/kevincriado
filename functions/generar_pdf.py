import json
import os
import base64
from google.oauth2 import service_account
from googleapiclient.discovery import build

SCOPES = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/documents']

def handler(event, context):
    try:
        # 1. --- Validate Environment Variables ---
        creds_base64 = os.environ.get('GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_BASE64')
        template_id = os.environ.get('GOOGLE_DRIVE_TEMPLATE_ID')
        folder_id = os.environ.get('GOOGLE_DRIVE_DESTINATION_FOLDER_ID')
        if not all([creds_base64, template_id, folder_id]):
            raise ValueError("Faltan una o más variables de entorno de Google en Netlify.")

        # 2. --- Authenticate with Google using Service Account ---
        creds_json = base64.b64decode(creds_base64).decode('utf-8')
        creds_info = json.loads(creds_json)
        credentials = service_account.Credentials.from_service_account_info(creds_info, scopes=SCOPES)
        
        drive_service = build('drive', 'v3', credentials=credentials)
        docs_service = build('docs', 'v1', credentials=credentials)
        
        # 3. --- Get Form Data ---
        if not event.get('body'):
            raise ValueError("No se recibieron datos en la solicitud.")
        data = json.loads(event.get('body'))
        
        session_date = data.get('FECHA_CONS', 'nodate').replace('/', '-')
        new_doc_name = f"HC_{data.get('NOMBRE_COMPLETO', 'SinNombre')}_{session_date}"

        # 4. --- Copy the Template File into the Shared Folder ---
        copied_file = drive_service.files().copy(
            fileId=template_id,
            body={'name': new_doc_name, 'parents': [folder_id]}
        ).execute()
        new_doc_id = copied_file.get('id')

        # 5. --- Prepare "Find and Replace" requests ---
        requests = []
        for key, value in data.items():
            requests.append({
                'replaceAllText': {
                    'containsText': {'text': f'{{{{{key}}}}}', 'matchCase': False},
                    'replaceText': str(value)
                }
            })

        # 6. --- Update the copied document ---
        docs_service.documents().batchUpdate(
            documentId=new_doc_id,
            body={'requests': requests}
        ).execute()

        # 7. --- Export the document as PDF ---
        pdf_content = drive_service.files().export(
            fileId=new_doc_id,
            mimeType='application/pdf'
        ).execute()
        
        # 8. --- Delete the temporary Google Doc ---
        drive_service.files().delete(fileId=new_doc_id).execute()

        # 9. --- Send the PDF to the browser ---
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
        error_detail = f"{type(e).__name__}: {e}"
        print(f"--- FUNCTION FAILED ---: {error_detail}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'message': "Error interno del servidor.",
                'error': error_detail
            })
        }

