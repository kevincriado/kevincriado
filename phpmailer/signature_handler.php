<?php
use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;
use PHPMailer\PHPMailer\SMTP;

// Este script es el endpoint del servidor (backend) que recibe la firma,
// la procesa y la envía por correo electrónico usando las credenciales SMTP de ZOHO Mail.

// ----------------------------------------------------
// PASO 1: INCLUIR LIBRERÍAS DE PHPMailer
// ¡IMPORTANTE! Asegúrate de que estas rutas sean correctas
// en tu servidor web. Si usaste Composer, la ruta es correcta.
// Si instalaste manualmente, ajústala (ej: require 'PHPMailer/src/Exception.php';)
// ----------------------------------------------------
require 'vendor/phpmailer/phpmailer/src/Exception.php';
require 'vendor/phpmailer/phpmailer/src/PHPMailer.php';
require 'vendor/phpmailer/phpmailer/src/SMTP.php';
// ----------------------------------------------------

header('Content-Type: application/json');

// Recibir y decodificar el JSON de la petición (POST)
$data = json_decode(file_get_contents('php://input'), true);

// Respuesta de error por defecto
$response = ['success' => false, 'message' => 'Error de procesamiento en el servidor.'];

if (empty($data) || !isset($data['type'])) {
    $response['message'] = 'Datos inválidos recibidos.';
    echo json_encode($response);
    exit;
}

$is_adult = $data['type'] === 'ADULTO';
$email_destino = 'kevincriadop@gmail.com'; // Correo de Kevin (profesional)

// --- Extracción de datos del Payload ---
$paciente_nombre = $data['paciente']['nombre'] ?? 'N/A';
$paciente_doc = $data['paciente']['documento'] ?? 'N/A';
$paciente_email = $data['paciente']['email'] ?? 'N/A';
$paciente_telefono = $data['paciente']['telefono'] ?? 'N/A';
$paciente_firma_base64 = $data['paciente']['firma'] ?? null;

// Correo para copia (CC) al paciente/representante legal
$email_copia_paciente = $is_adult ? $paciente_email : ($data['representante']['email'] ?? 'N/A');

$representante_nombre = 'N/A';
$representante_doc = 'N/A';
$representante_email = 'N/A'; // Inicializar para evitar errores

if (!$is_adult) {
    $representante_nombre = $data['representante']['nombre'] ?? 'N/A';
    $representante_doc = $data['representante']['documento'] ?? 'N/A';
    $representante_email = $data['representante']['email'] ?? 'N/A';
    $representante_firma_base64 = $data['representante']['firma'] ?? null;
} else {
    $representante_firma_base64 = null;
}


// ----------------------------------------------------
// PASO 2: Procesamiento de Firmas
// Convierte Base64 a archivo PNG temporal.
// ----------------------------------------------------

function decode_and_save_signature($base64_data, $name_suffix) {
    if (!$base64_data) {
        return null; // No hay datos de firma
    }
    // Eliminar el prefijo 'data:image/png;base64,'
    $base64_img = str_replace('data:image/png;base64,', '', $base64_data);
    $binary_data = base64_decode($base64_img);

    // Generar un nombre de archivo único para la firma
    $filename = 'firma_' . date('YmdHis') . '_' . $name_suffix . '.png';
    // Usar el directorio temporal del sistema para el almacenamiento temporal
    $filepath = sys_get_temp_dir() . '/' . $filename; 

    // Guardar el archivo temporalmente
    if (file_put_contents($filepath, $binary_data) !== false) {
        return ['path' => $filepath, 'name' => $filename];
    }
    return null;
}

$firma_paciente_info = decode_and_save_signature($paciente_firma_base64, 'pte');
$firma_representante_info = decode_and_save_signature($representante_firma_base64, 'rep');


// ----------------------------------------------------
// PASO 3: Construcción del Cuerpo del Correo
// ----------------------------------------------------

$asunto = $is_adult ? 
    "Firma Digital - Adulto: {$paciente_nombre} ({$paciente_doc})" :
    "Firma Digital - Menor: {$paciente_nombre} (Rep. {$representante_nombre})";

$cuerpo_html = "
<html>
<body style='font-family: Arial, sans-serif; line-height: 1.6; color: #333;'>
    <h2 style='color: #8A2BE2;'>Documentación de Firma Electrónica - Consultorio Psicológico</h2>
    <p>Se ha generado y validado con éxito la(s) firma(s) electrónica(s) de los siguientes documentos:</p>
    <ul>
        <li>Consentimiento Informado</li>
        <li>Autorización de Tratamiento de Datos Personales (Ley 1581)</li>
        <li>Apertura de Historia Clínica (Res. 3100)</li>
    </ul>

    <h3 style='color: #4682B4;'>Datos del Paciente:</h3>
    <ul>
        <li><strong>Nombre Completo:</strong> {$paciente_nombre}</li>
        <li><strong>Documento:</strong> {$paciente_doc}</li>
        <li><strong>Teléfono:</strong> {$paciente_telefono}</li>
        <li><strong>Correo:</strong> {$paciente_email}</li>
    </ul>
";

if (!$is_adult) {
    $cuerpo_html .= "
    <h3 style='color: #4682B4;'>Datos del Representante Legal (Obligatorio para Menores):</h3>
    <ul>
        <li><strong>Nombre:</strong> {$representante_nombre}</li>
        <li><strong>Documento:</strong> {$representante_doc}</li>
        <li><strong>Teléfono:</strong> {$data['representante']['telefono']}</li>
        <li><strong>Correo:</strong> {$data['representante']['email']}</li>
    </ul>
    ";
}

$cuerpo_html .= "
    <p style='margin-top: 20px; font-style: italic; color: #666;'>
        <strong>Evidencia Legal:</strong> Las firmas se adjuntan en formato PNG. Este acto de firma digital es válido según la Ley 527 de 1999 y la Ley 2213 de 2022. Una copia ha sido enviada al paciente/representante legal.
    </p>
    <p style='font-size: 10px; color: #999;'>Este correo ha sido generado automáticamente por el sistema de firmas del consultorio.</p>
</body>
</html>
";


// ----------------------------------------------------
// PASO 4: ENVÍO DE CORREO (Configuración Zoho Mail)
// ----------------------------------------------------

$mail = new PHPMailer(true);

try {
    // Server settings
    $mail->isSMTP();
    $mail->Host       = 'smtp.zoho.com';           // Host de Zoho
    $mail->SMTPAuth   = true;
    
    // *** CREDENCIALES REALES DE ZOHO MAIL (CORREGIDAS) ***
    $mail->Username   = 'psicologia@kevincriado.com';  
    $mail->Password   = 'JNNBBuHwqjKS';   
    // ******************************************************

    $mail->SMTPSecure = PHPMailer::ENCRYPTION_SMTPS; // Usar SSL para el puerto 465
    $mail->Port       = 465;                        // Puerto estándar de Zoho para SSL
    $mail->CharSet    = 'UTF-8';

    // Destinatarios
    $mail->setFrom('psicologia@kevincriado.com', 'Sistema de Firmas');
    $mail->addAddress($email_destino, 'Kevin Joel Criado Pérez (Profesional)');

    // Copia al paciente/representante legal para evidencia
    if ($email_copia_paciente && filter_var($email_copia_paciente, FILTER_VALIDATE_EMAIL)) {
        $mail->addCC($email_copia_paciente); 
    }
    
    // Contenido
    $mail->isHTML(true);
    $mail->Subject = $asunto;
    $mail->Body    = $cuerpo_html;
    $mail->AltBody = strip_tags($cuerpo_html);

    // Adjuntar firmas
    if ($firma_paciente_info) {
        $mail->addAttachment($firma_paciente_info['path'], $firma_paciente_info['name']);
    }
    if ($firma_representante_info) {
        $mail->addAttachment($firma_representante_info['path'], $firma_representante_info['name']);
    }

    $mail->send();

    // ----------------------------------------------------
    // PASO 5: ÉXITO - Limpiar archivos temporales
    // ----------------------------------------------------
    if ($firma_paciente_info && file_exists($firma_paciente_info['path'])) {
        unlink($firma_paciente_info['path']);
    }
    if ($firma_representante_info && file_exists($firma_representante_info['path'])) {
        unlink($firma_representante_info['path']);
    }

    $response['success'] = true;
    $response['message'] = '¡Firma(s) enviada(s) con éxito! Revisa tu correo.';

} catch (Exception $e) {
    $response['message'] = "El mensaje no pudo ser enviado. Error Mailer: {$mail->ErrorInfo}.";
    // Limpieza de archivos en caso de error
    if (isset($firma_paciente_info['path']) && file_exists($firma_paciente_info['path'])) {
        unlink($firma_paciente_info['path']);
    }
    if (isset($firma_representante_info['path']) && file_exists($firma_representante_info['path'])) {
        unlink($firma_representante_info['path']);
    }
}

echo json_encode($response);
?>
