import json
import os
import base64
import logging

# Importaciones del nuevo SDK de Adobe V3
from adobe.pdfservices.operation.auth.service_principal_credentials import ServicePrincipalCredentials
from adobe.pdfservices.operation.exception.exceptions import ServiceApiException, ServiceUsageException, SdkException
from adobe.pdfservices.operation.pdf_services import PDFServices
from adobe.pdfservices.operation.io.stream_asset import StreamAsset
from adobe.pdfservices.operation.pdfjobs.jobs.document_merge_job import DocumentMergeJob
from adobe.pdfservices.operation.pdfjobs.options.documentmerge.document_merge_options import DocumentMergeOptions
from adobe.pdfservices.operation.pdfjobs.result.document_merge_result import DocumentMergeResult

# Configurar logging básico para ver el progreso
logging.basicConfig(level=logging.INFO)

def handler(event, context):
    try:
        # 1. --- Validate Environment Variables ---
        client_id = os.environ.get('PDF_SERVICES_CLIENT_ID')
        client_secret = os.environ.get('PDF_SERVICES_CLIENT_SECRET')
        if not client_id or not client_secret:
            raise ValueError("Las variables de entorno 'PDF_SERVICES_CLIENT_ID' y 'PDF_SERVICES_CLIENT_SECRET' son requeridas.")

        # 2. --- Get Form Data ---
        if not event.get('body'):
            raise ValueError("No se recibieron datos en la solicitud.")
        data = json.loads(event.get('body'))
        
        # Adobe espera los datos bajo una clave raíz para la plantilla
        json_data_for_merge = {"hc": data}

        # 3. --- Adobe API Authentication (New Method) ---
        credentials = ServicePrincipalCredentials(client_id, client_secret)
        pdf_services = PDFServices(credentials=credentials)

        # 4. --- Prepare Template for Upload ---
        template_path = os.path.join(os.path.dirname(__file__), 'PlantillaHC.docx')
        if not os.path.exists(template_path):
            raise FileNotFoundError("El archivo de plantilla 'PlantillaHC.docx' no se encontró en el servidor.")
        
        with open(template_path, "rb") as f:
            template_stream = f.read()
        
        # Upload the template to Adobe's cloud to create an asset
        template_asset = pdf_services.upload(input_stream=template_stream, mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")

        # 5. --- Create and Execute the Document Generation Job ---
        document_merge_options = DocumentMergeOptions(json_data_for_merge, output_format="pdf")
        document_merge_job = DocumentMergeJob(template_asset, document_merge_options)
        
        # Submit the job and wait for the result
        location = pdf_services.submit(job=document_merge_job)
        pdf_services_response = pdf_services.get_job_result(location, DocumentMergeResult)
        
        # The result is a StreamAsset
        result_stream: StreamAsset = pdf_services_response.get_asset()
        
        # Read the content stream into a buffer
        pdf_buffer = result_stream.get_input_stream().read()

        # 6. --- Generate Filename and send to browser ---
        session_date = data.get('FECHA_SESION', 'nodate').replace('/', '-')
        documento = data.get('DOCUMENTO', 'NOID')
        filename = f"HC_{documento}_{session_date}.pdf"
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/pdf',
                'Content-Disposition': f'attachment; filename="{filename}"'
            },
            'body': base64.b64encode(pdf_buffer).decode('utf-8'),
            'isBase64Encoded': True
        }

    except (ServiceApiException, ServiceUsageException, SdkException) as e:
        logging.exception(f"Exception encountered while executing Adobe operation: {e}")
        return {
            'statusCode': 500,
            'body': json.dumps({'message': "Error al comunicarse con la API de Adobe.", 'error': str(e)})
        }
    except Exception as e:
        logging.exception(f"An unexpected error occurred: {e}")
        return {
            'statusCode': 500,
            'body': json.dumps({'message': "Error interno del servidor.",'error': str(e)})
        }


