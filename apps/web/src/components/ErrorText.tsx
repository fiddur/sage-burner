export const ErrorText = ({ message, id }: { message: string | undefined; id?: string }) =>
  message === undefined ? null : (
    <p class="form-error" role="alert" id={id}>
      {message}
    </p>
  )
