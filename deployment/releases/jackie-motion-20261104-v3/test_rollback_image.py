import importlib.util, unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

spec=importlib.util.spec_from_file_location('jackie_v3',Path(__file__).with_name('deploy.py'))
deploy=importlib.util.module_from_spec(spec);spec.loader.exec_module(deploy)

class RollbackTag(unittest.TestCase):
    def test_exact_image_is_requested_and_tag_is_verified(self):
        image='sha256:'+'a'*64;tag='royal-game:before-'+deploy.NAME
        reader=Mock(return_value={'Id':image,'RepoTags':['royal-game:latest',tag]})
        deploy.verify_rollback_tag(SimpleNamespace(docker_object=reader),image,tag)
        reader.assert_called_once_with('image',image)

    def test_tag_on_another_image_is_rejected(self):
        reader=Mock(return_value={'Id':'sha256:'+'b'*64,'RepoTags':['royal-game:rollback']})
        with self.assertRaisesRegex(RuntimeError,'Rollback image tag differs'):
            deploy.verify_rollback_tag(SimpleNamespace(docker_object=reader),'sha256:'+'a'*64,'royal-game:rollback')

    def test_missing_tag_is_rejected(self):
        image='sha256:'+'a'*64;reader=Mock(return_value={'Id':image,'RepoTags':['royal-game:latest']})
        with self.assertRaisesRegex(RuntimeError,'Rollback image tag differs'):
            deploy.verify_rollback_tag(SimpleNamespace(docker_object=reader),image,'royal-game:rollback')

if __name__=='__main__':unittest.main()
