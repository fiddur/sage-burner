export const ErrorText = ({
  message,
  id,
  link,
}: {
  message: string | undefined
  id?: string
  link?: { href: string; label: string }
}) =>
  message === undefined ? null : (
    <p class="form-error" role="alert" id={id}>
      {message}
      {link !== undefined && (
        <>
          {' '}
          <a href={link.href}>{link.label}</a>
        </>
      )}
    </p>
  )
