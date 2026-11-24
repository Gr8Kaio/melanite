# Plantillas de email para el login por código

Melanite entra con un **código numérico** (OTP), nunca con magic links: en iOS un link abre Safari y no la app instalada.
Para que el código llegue, cada plantilla tiene que mostrar `{{ .Token }}`. Las plantillas por defecto de Supabase solo traen un link, así que **hay que pegarlas a mano**.

## Dónde pegarlas

Supabase Dashboard → tu proyecto → **Authentication → Emails → Templates** (en proyectos nuevos: *Authentication → Email Templates*).

| Plantilla de Supabase | La usa | Qué hace en Melanite |
|---|---|---|
| **Magic Link** | `signInWithOtp` (y usuarios ya confirmados) | "Código por email" |
| **Confirm signup** | `signUp` con confirmación de email activada | código al crear cuenta |
| **Reset Password** | `resetPasswordForEmail` | "Olvidé mi contraseña" |

Para cada una: pegá el *Subject* y el *Message body* (modo HTML) y guardá.

El largo del código (6 a 8 dígitos) se define en *Authentication → Sign In / Providers → Email → Email OTP Length*; la app acepta de 6 a 8.

---

## Magic Link (código de acceso)

### English

Subject: `Your Melanite code: {{ .Token }}`

```html
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#241a1f">
  <h2 style="margin:0 0 8px">Your Melanite code</h2>
  <p style="margin:0 0 20px;color:#6b5a62">Type this code in the app to sign in:</p>
  <p style="margin:0 0 20px;font-size:36px;font-weight:700;letter-spacing:8px;font-family:ui-monospace,Menlo,Consolas,monospace;color:#a3304f">{{ .Token }}</p>
  <p style="margin:0;color:#6b5a62;font-size:13px">It expires in one hour. If you did not ask for it, ignore this email.</p>
</div>
```

### Español

Asunto: `Tu código de Melanite: {{ .Token }}`

```html
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#241a1f">
  <h2 style="margin:0 0 8px">Tu código de Melanite</h2>
  <p style="margin:0 0 20px;color:#6b5a62">Escribí este código en la app para entrar:</p>
  <p style="margin:0 0 20px;font-size:36px;font-weight:700;letter-spacing:8px;font-family:ui-monospace,Menlo,Consolas,monospace;color:#a3304f">{{ .Token }}</p>
  <p style="margin:0;color:#6b5a62;font-size:13px">Vence en una hora. Si no lo pediste, ignorá este email.</p>
</div>
```

---

## Confirm signup (confirmar cuenta)

### English

Subject: `Confirm your Melanite account: {{ .Token }}`

```html
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#241a1f">
  <h2 style="margin:0 0 8px">Confirm your account</h2>
  <p style="margin:0 0 20px;color:#6b5a62">Type this code in the app to finish creating your account:</p>
  <p style="margin:0 0 20px;font-size:36px;font-weight:700;letter-spacing:8px;font-family:ui-monospace,Menlo,Consolas,monospace;color:#a3304f">{{ .Token }}</p>
  <p style="margin:0;color:#6b5a62;font-size:13px">If you did not create an account, ignore this email.</p>
</div>
```

### Español

Asunto: `Confirmá tu cuenta de Melanite: {{ .Token }}`

```html
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#241a1f">
  <h2 style="margin:0 0 8px">Confirmá tu cuenta</h2>
  <p style="margin:0 0 20px;color:#6b5a62">Escribí este código en la app para terminar de crear tu cuenta:</p>
  <p style="margin:0 0 20px;font-size:36px;font-weight:700;letter-spacing:8px;font-family:ui-monospace,Menlo,Consolas,monospace;color:#a3304f">{{ .Token }}</p>
  <p style="margin:0;color:#6b5a62;font-size:13px">Si no creaste una cuenta, ignorá este email.</p>
</div>
```

---

## Reset Password (recuperar contraseña)

### English

Subject: `Reset your Melanite password: {{ .Token }}`

```html
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#241a1f">
  <h2 style="margin:0 0 8px">Reset your password</h2>
  <p style="margin:0 0 20px;color:#6b5a62">Type this code in the app, then choose a new password:</p>
  <p style="margin:0 0 20px;font-size:36px;font-weight:700;letter-spacing:8px;font-family:ui-monospace,Menlo,Consolas,monospace;color:#a3304f">{{ .Token }}</p>
  <p style="margin:0;color:#6b5a62;font-size:13px">If you did not ask for this, ignore this email.</p>
</div>
```

### Español

Asunto: `Recuperá tu contraseña de Melanite: {{ .Token }}`

```html
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#241a1f">
  <h2 style="margin:0 0 8px">Recuperá tu contraseña</h2>
  <p style="margin:0 0 20px;color:#6b5a62">Escribí este código en la app y después elegí una contraseña nueva:</p>
  <p style="margin:0 0 20px;font-size:36px;font-weight:700;letter-spacing:8px;font-family:ui-monospace,Menlo,Consolas,monospace;color:#a3304f">{{ .Token }}</p>
  <p style="margin:0;color:#6b5a62;font-size:13px">Si no lo pediste, ignorá este email.</p>
</div>
```

---

## Otros ajustes en Supabase

- **Authentication → Sign In / Providers → Email**: activado. *Confirm email* a gusto: si está activado, "Crear cuenta" pide el código de *Confirm signup*; si no, entra directo.
- **Redirect URLs / Site URL**: no importan para el código (la app nunca manda `emailRedirectTo`).
- **SMTP**: el servidor de email por defecto de Supabase manda pocos emails por hora (el plan gratis ronda los 2-4 por hora para todo el proyecto). Para uso real, configurá un SMTP propio en *Authentication → Emails → SMTP Settings* (Resend, Brevo, etc.). La app muestra un aviso claro cuando se llega al límite.
- Las plantillas son por proyecto, no por idioma: si querés un solo email, dejá el bloque en inglés y el español juntos en el mismo cuerpo.
