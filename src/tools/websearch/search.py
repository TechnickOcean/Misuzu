from ddg import Duckduckgo
from json import dumps
import sys

ddg_api = Duckduckgo()

def search(keywords):
  '''
  @reutrn {
    "success": boolean,
    "data": {
      "title": str,
      "url": str,
      "description": str
    }[]
  }
  '''
  return ddg_api.search(keywords)

if len(sys.argv) > 1:
  print(dumps(search(' '.join(sys.argv[1:]))))
else:
  print('''Invalid input!
  Usage: search.py <keywords>''')
