read -rs -p 'Colle le Client Secret : ' S && echo
aws secretsmanager create-secret --region eu-north-1 \
  --name omnipotent/dev/omnipass/client-secret --secret-string "$S" >/dev/null && unset S