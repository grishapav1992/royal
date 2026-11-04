import copy, importlib.util, unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('continuation', Path(__file__).with_name('continuation.py'))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


def fixture():
    before = {'sourceCommit':'old', 'sourceRevision':'old', 'source':{'game.ts':'game','lobby.ts':'old'},
              'sourceLF':{'game.ts':'game','lobby.ts':'old'}, 'program':{'index.js':'old'}, 'preparedProgram':{'index.js':'old'},
              'preparedImage':'old-image', 'container':{'id':'old','image':'old-image','startedAt':1,'health':'healthy','mounts':[]},
              'services':{'/royal-game-1':'old','other':'unchanged'}, 'serviceProfiles':{'royal-game-1':'old','other':'unchanged'},
              'moduleFiles':{'active.json':'same'},'configuration':'same'}
    after = copy.deepcopy(before)
    after.update(sourceCommit='new',sourceRevision='new',preparedImage='new-image',program={'index.js':'new'},preparedProgram={'index.js':'new'})
    after['container'].update(id='new',image='new-image',startedAt=2)
    after['source']['lobby.ts']=after['sourceLF']['lobby.ts']='new'
    after['services']['/royal-game-1']=after['serviceProfiles']['royal-game-1']='new'
    plan={'applicationSourceCommit':'fixed','preparedBaseCommit':'old','actualBaseCommit':'new','actualBaseImage':'new-image',
          'sourceChanges':{'lobby.ts':{'before':'old','after':'new'}},'sourceRawChanges':{'lobby.ts':{'before':'old','after':'new'}},
          'programChanges':{'index.js':{'before':'old','after':'new'}}}
    release={'sourceCommit':'fixed','baseCommit':'old','moduleProjection':{'inputs':{'game.ts':'new-game','stable.ts':'stable'}}}
    for row in [before,after]: row['sourceLF']['stable.ts']='stable'
    op={'source':{'game.ts':'new-game'}}
    return plan,before,after,release,op


class Preservation(unittest.TestCase):
    def test_reviewed_lobby_transition_preserves_fixed_game_artifact(self):
        c.validate_transition(*fixture())

    def test_rejects_other_source_program_module_service_or_configuration(self):
        for field,key in [('source','foreign.ts'),('sourceLF','game.ts'),('program','foreign.js'),('moduleFiles','active.json'),
                          ('services','other'),('serviceProfiles','other'),('container','mounts')]:
            plan,before,after,release,op=fixture(); after[field][key]='unexpected'
            with self.subTest(field=field):
                with self.assertRaises(RuntimeError): c.validate_transition(plan,before,after,release,op)

    def test_review_cannot_replace_game_sources_or_build_inputs(self):
        plan,before,after,release,op=fixture()
        for field,changes in [('source','sourceRawChanges'),('sourceLF','sourceChanges')]:
            modified=copy.deepcopy(after);modified[field]['game.ts']='other-game'
            review=copy.deepcopy(plan);review[changes]['game.ts']={'before':'game','after':'other-game'}
            with self.assertRaises(RuntimeError):c.validate_transition(review,before,modified,release,op)
        modified=copy.deepcopy(after);modified['sourceLF']['stable.ts']='changed'
        review=copy.deepcopy(plan);review['sourceChanges']['stable.ts']={'before':'stable','after':'changed'}
        with self.assertRaises(RuntimeError):c.validate_transition(review,before,modified,release,op)

    def test_changed_artifact_image_or_revision_is_rejected(self):
        for location,key in [('plan','applicationSourceCommit'),('plan','preparedBaseCommit'),('plan','actualBaseCommit'),
                             ('plan','actualBaseImage'),('after','preparedImage'),('after','sourceRevision')]:
            plan,before,after,release,op=fixture(); (plan if location=='plan' else after)[key]='wrong'
            with self.assertRaises(RuntimeError):c.validate_transition(plan,before,after,release,op)


if __name__ == '__main__':
    unittest.main()
